/// <reference lib="webworker" />

import { calculateIOIndicators } from '../core/calculator';
import type { CalculationWorkerRequest, CalculationWorkerResponse } from './protocol';

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<CalculationWorkerRequest>) => {
    const request = event.data;
    if (request.type !== 'calculate') return;

    try {
        const { results, errors } = calculateIOIndicators(request.data, request.config);
        const response: CalculationWorkerResponse = {
            type: 'result',
            requestId: request.requestId,
            results,
            issues: errors
        };
        workerScope.postMessage(response);
    } catch (error) {
        const response: CalculationWorkerResponse = {
            type: 'error',
            requestId: request.requestId,
            message: error instanceof Error ? error.message : '未知计算错误'
        };
        workerScope.postMessage(response);
    }
};

export {};
