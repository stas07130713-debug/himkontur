import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import './ui/styles.css';

registerSW({ immediate: true });

const root = document.getElementById('root');
if (root === null) throw new Error('Корневой элемент интерфейса не найден.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
