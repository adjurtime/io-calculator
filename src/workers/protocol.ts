import type {
    CalculationConfig,
    CalculationError,
    CalculationResults,
    IOData
} from '../types/io';

export interface CalculationWorkerRequest {
    type: 'calculate';
    requestId: number;
    data: IOData;
    config: CalculationConfig;
}

export type CalculationWorkerResponse =
    | {
        type: 'result';
        requestId: number;
        results: CalculationResults;
        issues: CalculationError[];
    }
    | {
        type: 'error';
        requestId: number;
        message: string;
    };
