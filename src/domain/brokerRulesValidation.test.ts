import { describe, expect, it } from 'vitest';
import {
  getStopOutValidationMessage,
  STOP_OUT_ABOVE_MAINTENANCE_MESSAGE
} from './brokerRulesValidation';

describe('broker rules stop-out validation', () => {
  it('rejects stop-out equity above maintenance equity', () => {
    expect(getStopOutValidationMessage('10', '5')).toBe(STOP_OUT_ABOVE_MAINTENANCE_MESSAGE);
  });

  it('accepts stop-out equity equal to or below maintenance equity', () => {
    expect(getStopOutValidationMessage('5', '5')).toBeNull();
    expect(getStopOutValidationMessage('3', '12.5')).toBeNull();
  });

  it('defers empty and non-numeric values to native input validation', () => {
    expect(getStopOutValidationMessage('', '5')).toBeNull();
    expect(getStopOutValidationMessage('10', '')).toBeNull();
    expect(getStopOutValidationMessage('abc', '5')).toBeNull();
  });
});
