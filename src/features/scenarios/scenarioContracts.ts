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
  note: string;
}

export type ScenarioModalData =
  | (ScenarioModalBase & { kind: 'buy-more' })
  | (ScenarioModalBase & { kind: 'exit-comparison' });
