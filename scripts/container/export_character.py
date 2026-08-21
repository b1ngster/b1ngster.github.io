"""Headless MPFB character export for the b1ngster lobby.

Builds a character from a gender template .mhm with overridden ethnicity
macro modifiers and an ethnicity-appropriate skin, transplants the shared
idle/walk animations from an existing export (same default_no_toes rig,
so the actions bind by bone name), and exports a GLB ready for
pack-models.sh on the web side.

usage: blender --background --python export_character.py -- \
    <gender: male|female|nonbinary> <variant> <african> <asian> <caucasian> \
    <skin dir name under mpfb-assets/skins, or "default"> <out.glb>
"""
import bpy
import sys
from pathlib import Path

# Start from a truly empty scene — the default cube must not ship.
bpy.ops.wm.read_factory_settings(use_empty=True)

from bl_ext.user_default.mpfb.services.humanservice import HumanService

args = sys.argv[sys.argv.index("--") + 1:]
gender, variant, af, asi, cau, skin, out = args[:7]
# optional 8th arg "bare": no clothes, no hair — the full body mesh, for
# inspecting the macro deformations directly on the skin
BARE = len(args) > 7 and args[7] == "bare"
V1 = Path("/root/makehuman/v1py3")

# --- 1. Variant .mhm: the gender template with new ethnicity weights ------
lines = []
for ln in (V1 / "models" / f"{gender}_clothed.mhm").read_text().splitlines():
    if BARE and (ln.startswith("clothes") or ln.startswith("hair ")):
        continue
    if ln.startswith("modifier macrodetails/African "):
        ln = "modifier macrodetails/African 0.340000"
    elif ln.startswith("modifier macrodetails/Asian "):
        ln = "modifier macrodetails/Asian 0.330000"
    elif ln.startswith("modifier macrodetails/Caucasian "):
        ln = "modifier macrodetails/Caucasian 0.330000"
    elif ln.startswith("modifier macrodetails-universal/Weight "):
        ln = "modifier macrodetails-universal/Weight 0.500000"
    elif ln.startswith("modifier macrodetails-universal/Muscle "):
        ln = "modifier macrodetails-universal/Muscle 0.500000"
    elif ln.startswith("modifier macrodetails-proportions/BodyProportions "):
        ln = "modifier macrodetails-proportions/BodyProportions 0.500000"
    elif ln.startswith("name "):
        ln = f"name {variant}"
    lines.append(ln)
if skin != "default":
    lines.append(f"skinMaterial skins/{skin}/{skin}.mhmat")
mhm = Path(f"/tmp/{variant}.mhm")
mhm.write_text("\n".join(lines) + "\n")

# --- 2. Build the human (same rig as the existing exports) ----------------
settings = HumanService.get_default_deserialization_settings()
settings["clothes_deep_search"] = True
settings["bodypart_deep_search"] = True
settings["subdiv_levels"] = 0  # export the base cage; subdiv would 4x the mesh
settings["override_rig"] = "default_no_toes"
settings["override_skin_model"] = "MAKESKIN"
basemesh = HumanService.deserialize_from_mhm(str(mhm), settings)
print("BUILT:", basemesh.name)

armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")

# --- 2b. Bake MakeHuman's own macro deformations as shape keys ------------
# Build the same character again at Weight 1.0 (and Muscle 0.9), and copy
# the vertex deltas onto the main build's meshes as morph targets. Same
# .mhm, same assets, same build order => identical topology and vertex
# order; feet_on_ground aligns both builds at the floor. glTF exports
# shape keys as morph targets, and the app drives them from the sliders —
# the real MakeHuman deformation, not a bone approximation.
# Six directional morphs spanning MakeHuman's FULL macro range from the
# canonical 0.5 midpoints — the sliders map 1:1 onto MakeHuman values,
# with real muscle contours and true proportion shifts, and the skeleton
# is never scaled.
# Anatomy morphs, baked only into the bare bodies: parametric breasts
# (MakeHuman's own BreastSize/BreastFirmness macros) and genital targets
# — the anatomical accuracy that lets real clothing conform properly.
ANATOMY = {
    "macro_breastsize_up": {"breast/BreastSize": "1.000000"},
    "macro_breastsize_down": {"breast/BreastSize": "0.000000"},
    "macro_breastfirm_up": {"breast/BreastFirmness": "1.000000"},
    "macro_breastfirm_down": {"breast/BreastFirmness": "0.000000"},
    "macro_genital_up": {
        "genitals/penis-length-decr|incr": "1.000000",
        "genitals/penis-circ-decr|incr": "0.700000",
        "genitals/penis-testicles-decr|incr": "0.700000",
    },
    "macro_genital_down": {
        "genitals/penis-length-decr|incr": "-1.000000",
        "genitals/penis-circ-decr|incr": "-0.700000",
        "genitals/penis-testicles-decr|incr": "-0.700000",
    },
}

MACROS = {
    "macro_african": {"macrodetails/African": "1.000000", "macrodetails/Asian": "0.000000", "macrodetails/Caucasian": "0.000000"},
    "macro_asian": {"macrodetails/African": "0.000000", "macrodetails/Asian": "1.000000", "macrodetails/Caucasian": "0.000000"},
    "macro_caucasian": {"macrodetails/African": "0.000000", "macrodetails/Asian": "0.000000", "macrodetails/Caucasian": "1.000000"},
    "macro_weight_up": {"macrodetails-universal/Weight": "1.000000"},
    "macro_weight_down": {"macrodetails-universal/Weight": "0.000000"},
    "macro_muscle_up": {"macrodetails-universal/Muscle": "1.000000"},
    "macro_muscle_down": {"macrodetails-universal/Muscle": "0.000000"},
    "macro_proportions_up": {"macrodetails-proportions/BodyProportions": "1.000000"},
    "macro_proportions_down": {"macrodetails-proportions/BodyProportions": "0.000000"},
}

# glTF export drops shape keys from meshes that still need modifiers
# applied (the body wears a mask modifier hiding faces under clothes) —
# so apply everything except the armature FIRST, identically on every
# build, keeping vertex order aligned for the delta transfer.
def strip_shape_keys(objs):
    # MPFB expresses the character's macro mix (gender, age, weight,
    # ethnicity) AS shape keys on the base mesh — clearing them naively
    # reverts to the default body. Bake the current mix into the base
    # vertex positions first, then drop the keys.
    for o in objs:
        if o.type == "MESH" and o.data.shape_keys:
            mix = o.shape_key_add(name="__mix", from_mix=True)
            for i, v in enumerate(o.data.vertices):
                v.co = mix.data[i].co
            print("BAKED MIX:", o.name, len(o.data.shape_keys.key_blocks) - 1, "keys")
            o.shape_key_clear()

def apply_non_armature_modifiers(objs):
    for o in objs:
        if o.type != "MESH":
            continue
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            if mod.type != "ARMATURE":
                try:
                    bpy.ops.object.modifier_apply(modifier=mod.name)
                except Exception as exc:
                    print("MODAPPLY FAIL", o.name, mod.name, exc)

def build_variant(tag, overrides):
    lines2 = []
    seen = set()
    for ln in mhm.read_text().splitlines():
        for key, value in overrides.items():
            if ln.startswith(f"modifier {key} "):
                ln = f"modifier {key} {value}"
                seen.add(key)
        lines2.append(ln)
    # modifiers absent from the template (breast lines, genital targets)
    # are appended so overrides always take effect
    for key, value in overrides.items():
        if key not in seen:
            lines2.append(f"modifier {key} {value}")
    vpath = Path(f"/tmp/{variant}_{tag}.mhm")
    vpath.write_text("\n".join(lines2) + "\n")
    before = set(bpy.data.objects)
    HumanService.deserialize_from_mhm(str(vpath), settings)
    return [o for o in bpy.data.objects if o not in before]

strip_shape_keys(list(bpy.data.objects))
apply_non_armature_modifiers(list(bpy.data.objects))
main_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
ALL_MACROS = dict(MACROS)
if BARE:
    ALL_MACROS.update(ANATOMY)
for key_name, overrides in ALL_MACROS.items():
    variant_objs = build_variant(key_name, overrides)
    strip_shape_keys(variant_objs)
    apply_non_armature_modifiers(variant_objs)
    variant_meshes = {len(o.data.vertices): o for o in variant_objs if o.type == "MESH"}
    for obj in main_meshes:
        src = variant_meshes.get(len(obj.data.vertices))
        if src is None:
            print("NO MATCH for", obj.name, "in", key_name)
            continue
        if obj.data.shape_keys is None:
            obj.shape_key_add(name="Basis", from_mix=False)
        sk = obj.shape_key_add(name=key_name, from_mix=False)
        src_verts = src.data.vertices
        for i, skv in enumerate(sk.data):
            skv.co = src_verts[i].co
    for o in variant_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    print("MORPH BAKED:", key_name)

# --- 4. Transplant idle/walk from an existing export. The nonbinary GLB is
# the donor for every gender: it carries both clips and all exports share
# the same default_no_toes rig, so the actions bind by bone name.
keep = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(V1 / "nonbinary.glb"))
for o in [o for o in bpy.data.objects if o not in keep]:
    bpy.data.objects.remove(o, do_unlink=True)
ad = armature.animation_data_create()
for name in ("idle", "walk"):
    act = bpy.data.actions.get(name)
    if act is None:
        raise RuntimeError(f"no action {name} in donor nonbinary.glb")
    act.use_fake_user = True
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, act)
    # Blender 4.4+ slotted actions: bind the strip to the action's slot
    if hasattr(strip, "action_slot") and getattr(act, "slots", None):
        strip.action_slot = act.slots[0]
print("ANIMS:", [t.name for t in ad.nla_tracks])

# --- 5. Export --------------------------------------------------------------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_animation_mode="NLA_TRACKS",
    export_apply=False,  # masks were applied manually; applying here drops shape keys
)
print("EXPORTED:", out)
