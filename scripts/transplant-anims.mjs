/* Transplant animations from a donor GLB into a target GLB at the glTF
 * level, matching joints by node name. The Blender-side NLA transplant
 * exported frozen two-key poses; the original hand-exported clips have
 * the real keyframes, and every export shares the same rig names.
 * usage: node scripts/transplant-anims.mjs donor.glb target.glb out.glb
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const [donorPath, targetPath, outPath] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const donor = await io.read(donorPath)
const target = await io.read(targetPath)

const targetNodes = new Map()
for (const n of target.getRoot().listNodes()) targetNodes.set(n.getName(), n)

// out with the frozen clips
for (const a of target.getRoot().listAnimations()) a.dispose()

const buffer = target.getRoot().listBuffers()[0]
for (const anim of donor.getRoot().listAnimations()) {
  const newAnim = target.createAnimation(anim.getName())
  const samplerMap = new Map()
  for (const ch of anim.listChannels()) {
    const nodeName = ch.getTargetNode()?.getName()
    const destNode = targetNodes.get(nodeName)
    if (!destNode) continue
    const s = ch.getSampler()
    let newSampler = samplerMap.get(s)
    if (!newSampler) {
      const inputAcc = target.createAccessor()
        .setType(s.getInput().getType())
        .setArray(s.getInput().getArray().slice())
        .setBuffer(buffer)
      const outputAcc = target.createAccessor()
        .setType(s.getOutput().getType())
        .setArray(s.getOutput().getArray().slice())
        .setBuffer(buffer)
      newSampler = target.createAnimationSampler()
        .setInput(inputAcc)
        .setOutput(outputAcc)
        .setInterpolation(s.getInterpolation())
      newAnim.addSampler(newSampler)
      samplerMap.set(s, newSampler)
    }
    const newCh = target.createAnimationChannel()
      .setTargetNode(destNode)
      .setTargetPath(ch.getTargetPath())
      .setSampler(newSampler)
    newAnim.addChannel(newCh)
  }
  console.log('transplanted', anim.getName(), newAnim.listChannels().length, 'channels')
}

await io.write(outPath, target)
console.log('written', outPath)
