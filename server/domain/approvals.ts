import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ApprovalsDatasetSchema, type ApprovalItem } from '../../shared/schemas';

export interface Dataset {
  referenceDate: string;
  items: ApprovalItem[];
}

let cached: Dataset | undefined;

/** Reads and validates the seeded queue. Throws at boot if the fixture is malformed (fail fast). */
export function loadDataset(): Dataset {
  if (!cached) {
    const raw = readFileSync(path.join(__dirname, '../../data/approvals.json'), 'utf8');
    cached = ApprovalsDatasetSchema.parse(JSON.parse(raw));
  }
  return cached;
}

export function getPendingItems(items: readonly ApprovalItem[]): ApprovalItem[] {
  return items.filter((i) => i.status === 'pending_review');
}
