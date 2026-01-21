/**
 * Sample Project Definitions
 * Demo₈: Self-Build Test
 *
 * Provides sample project configurations for testing self-build:
 * - Todo CLI (simple)
 * - Notes API (medium)
 * - Blog Platform (complex)
 */

import { SelfBuildConfig } from './index.js';

/**
 * Todo CLI - Simple command-line application.
 * Good for quick testing of the self-build pipeline.
 */
export const todoCli: SelfBuildConfig = {
  projectName: 'todo-cli',
  projectDescription: 'A simple command-line todo list application',
  features: [
    'Add new todo items',
    'List all todos',
    'Mark todos as complete',
    'Delete todos',
    'Persist todos to file',
  ],
  techStack: ['TypeScript', 'Node.js', 'Commander.js'],
  maxExecutionTime: 30,
  maxBudget: 25,
  maxConcurrentAgents: 3,
};

/**
 * Notes API - Medium complexity REST API.
 * Tests database integration and API design.
 */
export const notesApi: SelfBuildConfig = {
  projectName: 'notes-api',
  projectDescription: 'A REST API for managing notes with tags and search',
  features: [
    'Create, read, update, delete notes',
    'Add tags to notes',
    'Search notes by content or tags',
    'Sort and filter notes',
    'Export notes to JSON',
    'Import notes from JSON',
  ],
  techStack: ['TypeScript', 'Node.js', 'Express', 'SQLite'],
  maxExecutionTime: 45,
  maxBudget: 35,
  maxConcurrentAgents: 4,
};

/**
 * Blog Platform - Complex full-stack application.
 * Tests multi-component coordination and user workflows.
 */
export const blogPlatform: SelfBuildConfig = {
  projectName: 'blog-platform',
  projectDescription: 'A full-featured blog platform with user management',
  features: [
    'User registration and authentication',
    'Create and edit blog posts',
    'Markdown support for content',
    'Comment system',
    'Tag-based categorization',
    'Search functionality',
    'RSS feed generation',
    'Admin dashboard',
  ],
  techStack: ['TypeScript', 'Node.js', 'Express', 'PostgreSQL', 'React'],
  maxExecutionTime: 60,
  maxBudget: 50,
  maxConcurrentAgents: 5,
};

/**
 * Calculator Library - Minimal project for unit testing.
 * Fastest possible validation of the pipeline.
 */
export const calculatorLib: SelfBuildConfig = {
  projectName: 'calculator-lib',
  projectDescription: 'A simple calculator library with basic operations',
  features: [
    'Add two numbers',
    'Subtract two numbers',
    'Multiply two numbers',
    'Divide two numbers',
    'Handle division by zero',
  ],
  techStack: ['TypeScript', 'Node.js'],
  maxExecutionTime: 15,
  maxBudget: 10,
  maxConcurrentAgents: 2,
};

/**
 * Weather CLI - API integration example.
 * Tests external API handling.
 */
export const weatherCli: SelfBuildConfig = {
  projectName: 'weather-cli',
  projectDescription: 'A CLI tool to fetch and display weather information',
  features: [
    'Fetch current weather by city',
    'Display temperature in Celsius or Fahrenheit',
    'Show weather conditions and humidity',
    'Cache recent lookups',
    'Support for default city configuration',
  ],
  techStack: ['TypeScript', 'Node.js', 'Axios', 'Commander.js'],
  maxExecutionTime: 25,
  maxBudget: 20,
  maxConcurrentAgents: 3,
};

/**
 * Get all sample projects.
 */
export function getAllSampleProjects(): Record<string, SelfBuildConfig> {
  return {
    'todo-cli': todoCli,
    'notes-api': notesApi,
    'blog-platform': blogPlatform,
    'calculator-lib': calculatorLib,
    'weather-cli': weatherCli,
  };
}

/**
 * Get a sample project by name.
 */
export function getSampleProject(name: string): SelfBuildConfig | undefined {
  return getAllSampleProjects()[name];
}

/**
 * List all sample project names.
 */
export function listSampleProjects(): string[] {
  return Object.keys(getAllSampleProjects());
}

/**
 * Create a custom project configuration with defaults.
 */
export function createProjectConfig(
  name: string,
  description: string,
  features: string[],
  techStack: string[],
  options: Partial<Omit<SelfBuildConfig, 'projectName' | 'projectDescription' | 'features' | 'techStack'>> = {}
): SelfBuildConfig {
  return {
    projectName: name,
    projectDescription: description,
    features,
    techStack,
    maxExecutionTime: options.maxExecutionTime ?? 60,
    maxBudget: options.maxBudget ?? 50,
    maxConcurrentAgents: options.maxConcurrentAgents ?? 5,
    simulatedMode: options.simulatedMode ?? false,
    simulatedDuration: options.simulatedDuration ?? 5000,
    simulatedSuccessRate: options.simulatedSuccessRate ?? 0.95,
  };
}

/**
 * Create a simulated test configuration from a sample project.
 */
export function createSimulatedConfig(
  baseName: string,
  simulatedDuration: number = 100,
  simulatedSuccessRate: number = 1.0
): SelfBuildConfig {
  const baseConfig = getSampleProject(baseName);
  if (!baseConfig) {
    throw new Error(`Sample project not found: ${baseName}`);
  }

  return {
    ...baseConfig,
    simulatedMode: true,
    simulatedDuration,
    simulatedSuccessRate,
  };
}

/**
 * Sample projects organized by complexity level.
 */
export const projectsByComplexity = {
  simple: [calculatorLib, todoCli],
  medium: [weatherCli, notesApi],
  complex: [blogPlatform],
};

/**
 * Get recommended sample project for Demo₈ validation.
 * Uses todo-cli as the default since it's quick but comprehensive.
 */
export function getDemo8SampleProject(): SelfBuildConfig {
  return {
    ...todoCli,
    simulatedMode: true,
    simulatedDuration: 100, // Fast execution for testing
    simulatedSuccessRate: 1.0, // Always succeed in tests
  };
}
