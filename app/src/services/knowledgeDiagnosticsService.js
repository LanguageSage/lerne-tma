import api from './api.js';
import { createKnowledgeDiagnosticsService } from './knowledgeDiagnosticsClient.js';

const diagnostics = createKnowledgeDiagnosticsService(api);
export const getDiagnosticsSummary = diagnostics.summary;
export const getDiagnosticsItems = diagnostics.items;
