import { Canvas } from '@react-three/fiber'
import { Scene } from './Scene'
import styles from'./App.css';

function App() {
  return (
    <Canvas id={styles["Canvas-container"]}>
      <Scene />
    </Canvas>
  )
}
export default App