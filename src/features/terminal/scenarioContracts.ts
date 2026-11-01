interface ScenarioExitPoint {
  label: string;
  days: number;
  price: number;
}

export type ScenarioInput =
  | {
      kind: 'single-projection';
      ticker?: string;
      price: number;
      days: number;
    }
  | {
      kind: 'exit-comparison';
      ticker?: string;
      scenarios: ScenarioExitPoint[];
    }
  | {
      kind: 'buy-more';
      ticker: string;
      shares: number;
      price: number;
    };

interface ScenarioModalRow {
  label: string;
  values: string[];
  kind?: 'section' | 'fee' | 'result' | 'risk' | 'balance';
  deltas?: Array<string | undefined>;
}

interface ScenarioModalBase {
  title: string;
  subtitle: string;
  columns: string[];
  rows: ScenarioModalRow[];
  presets?: Array<{ label: string; columnIndexes: number[] }>;
  quickActions?: Array<{ label: string; command?: string; columnIndexes?: number[]; invert?: boolean }>;
  action?: { label: string; command: string };
  note: string;
}

export type ScenarioModalData =
  | (ScenarioModalBase & { kind: 'buy-more' })
  | (ScenarioModalBase & { kind: 'exit-comparison' });
