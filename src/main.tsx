import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app/App';

// No StrictMode: its double mount would create and destroy a WebGPU device during start-up.
createRoot(document.getElementById('root')!).render(<App />);
