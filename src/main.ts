import '../style.css';
import '../app.js';
import { pullCloudState, pushCloudState } from './services/api';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).pullCloudState = pullCloudState;
  (window as unknown as Record<string, unknown>).pushCloudState = pushCloudState;
}