/**
 * Workflow Module
 * Exports workflow engine and related services
 */

export {
  WorkflowEngine,
  createWorkflowEngine,
  getWorkflowEngine,
  type WorkflowPhase,
  type DemoPhase,
  type ArchitectOutput,
  type BuildResult,
  type WorkflowEngineOptions,
  type WorkflowState,
} from './engine.js';

export {
  AutoTriggerService,
  getAutoTriggerService,
  triggerProjectBuild,
  onProjectCreatedHook,
  type AutoTriggerConfig,
} from './auto-trigger.js';
