import { ErrorType } from '../types/workflow.types';

const FATAL_PATTERNS = [
  'INVALID_CREDENTIALS',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'FATAL',
];

export function classifyError(message: string): ErrorType {
  const upper = message.toUpperCase();
  return FATAL_PATTERNS.some((p) => upper.includes(p)) ? 'fatal' : 'transient';
}
