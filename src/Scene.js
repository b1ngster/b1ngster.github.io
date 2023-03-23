import React, { useState } from 'react'
import './App.css'
import { OrbitControls, Sky, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'

export const Scene = () => {

  const mesh = React.useRef()
  const [color, setColor] = useState('blue')
  const [opacity, setOpacity] = useState(1)
  const [isRotating, setIsRotating] = useState(false)

  //  rerender
  useFrame(({ clock }, delta, xrFrame) => {
    if (isRotating) mesh.current.rotation.x += 0.001
  })

  return (
    <>
      <Sky distance={450000} sunPosition={[0, 1, 0]} inclination={0} azimuth={0.25} />
      <ambientLight intensity={0.1} />
      <directionalLight color="white" intensity={0.2} position={[0, 0, 5]} />
      <OrbitControls></OrbitControls>
      <mesh
        ref={mesh}
        rotation={[0, 0, 0]}
        onClick={() => setColor('yellow')}
        onPointerEnter={() => {
          setOpacity(0.5)
          setIsRotating(true)
        }}
        onPointerLeave={() => {
          setOpacity(1)
          setIsRotating(false)
        }}
      >
      <Text
        scale={[1, 1, 1]}
        color="black" 
        anchorX="center" 
        anchorY="middle" 
      >
         B1ngster
      </Text>
        <meshStandardMaterial color={color} opacity={opacity} transparent={true} />
      </mesh>
    </>
  )
}