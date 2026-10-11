import '../style.css';
import '../app.js';
import { pullCloudState, pushCloudState } from './services/api.js';

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).pullCloudState = pullCloudState;
  (window as unknown as Record<string, unknown>).pushCloudState = pushCloudState;
}
