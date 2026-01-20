import type {
  Project,
  Agent,
  Notification,
  ActivityItem,
  DashboardStats,
} from "@/types";

export const mockProjects: Project[] = [
  {
    id: "proj-1",
    name: "Pet Store App",
    clientName: "PetCo Inc.",
    description: "E-commerce platform for pet supplies with inventory management",
    status: "demo_ready",
    progress: 45,
    currentPhase: "Demo₀ Complete",
    budgetLimit: 500,
    budgetSpent: 127.5,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    demoNumber: 0,
  },
  {
    id: "proj-2",
    name: "Study Buddy",
    clientName: "Acme Corp",
    description: "AI-powered study assistant for students",
    status: "demo_ready",
    progress: 62,
    currentPhase: "Demo₁ Complete",
    budgetLimit: 800,
    budgetSpent: 289.0,
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 45 * 60 * 1000),
    demoNumber: 1,
  },
  {
    id: "proj-3",
    name: "Blog Platform",
    clientName: "MediaCo",
    description: "Modern blogging platform with CMS and analytics",
    status: "demo_building",
    progress: 52,
    currentPhase: "Building Demo₀",
    budgetLimit: 300,
    budgetSpent: 120.0,
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
    demoNumber: 0,
    estimatedCompletion: "~25 min",
  },
  {
    id: "proj-4",
    name: "Portfolio Site",
    clientName: "John Doe",
    description: "Personal portfolio website with project showcase",
    status: "building",
    progress: 87,
    currentPhase: "Full Build",
    budgetLimit: 150,
    budgetSpent: 89.0,
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 10 * 60 * 1000),
    demoNumber: 2,
    estimatedCompletion: "~1 hr",
  },
  {
    id: "proj-5",
    name: "Invoice App",
    clientName: "FinCorp",
    description: "Invoice generation and tracking system",
    status: "completed",
    progress: 100,
    currentPhase: "Complete",
    budgetLimit: 400,
    budgetSpent: 312.0,
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    demoNumber: 2,
  },
  {
    id: "proj-6",
    name: "Landing Page",
    clientName: "StartupXYZ",
    description: "Marketing landing page with lead capture",
    status: "completed",
    progress: 100,
    currentPhase: "Complete",
    budgetLimit: 200,
    budgetSpent: 78.0,
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    demoNumber: 1,
  },
];

export const mockAgents: Agent[] = [
  {
    id: "agent-1",
    projectId: "proj-3",
    type: "orchestrator",
    status: "working",
    currentTask: "Coordinating demo build",
    lastActivity: new Date(),
  },
  {
    id: "agent-2",
    projectId: "proj-3",
    type: "architect",
    status: "completed",
    currentTask: "Architecture design complete",
    lastActivity: new Date(Date.now() - 30 * 60 * 1000),
  },
  {
    id: "agent-3",
    projectId: "proj-3",
    type: "developer",
    status: "working",
    currentTask: "Building blog post editor",
    progress: 65,
    lastActivity: new Date(),
  },
  {
    id: "agent-4",
    projectId: "proj-3",
    type: "developer",
    status: "working",
    currentTask: "Creating responsive layout",
    progress: 40,
    lastActivity: new Date(),
  },
  {
    id: "agent-5",
    projectId: "proj-4",
    type: "orchestrator",
    status: "working",
    currentTask: "Managing full build",
    lastActivity: new Date(),
  },
  {
    id: "agent-6",
    projectId: "proj-4",
    type: "developer",
    status: "working",
    currentTask: "Implementing contact form",
    progress: 80,
    lastActivity: new Date(),
  },
  {
    id: "agent-7",
    projectId: "proj-4",
    type: "tester",
    status: "working",
    currentTask: "Writing unit tests",
    progress: 55,
    lastActivity: new Date(),
  },
  {
    id: "agent-8",
    projectId: "proj-4",
    type: "qa",
    status: "idle",
    lastActivity: new Date(Date.now() - 15 * 60 * 1000),
  },
];

export const mockNotifications: Notification[] = [
  {
    id: "notif-1",
    projectId: "proj-1",
    level: "needs_input",
    title: "Demo₀ Ready for Review",
    message: "Pet Store App demo is complete and waiting for your review",
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    read: false,
  },
  {
    id: "notif-2",
    projectId: "proj-2",
    level: "needs_input",
    title: "Demo₁ Ready for Review",
    message: "Study Buddy demo is complete with core features",
    createdAt: new Date(Date.now() - 45 * 60 * 1000),
    read: false,
  },
  {
    id: "notif-3",
    projectId: "proj-5",
    level: "info",
    title: "Build Complete",
    message: "Invoice App is ready to ship!",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    read: true,
  },
];

export const mockActivity: ActivityItem[] = [
  {
    id: "act-1",
    projectId: "proj-3",
    agentType: "developer",
    action: "Created component",
    details: "BlogPostEditor.tsx",
    timestamp: new Date(),
  },
  {
    id: "act-2",
    projectId: "proj-4",
    agentType: "tester",
    action: "Wrote tests",
    details: "ContactForm.test.ts",
    timestamp: new Date(Date.now() - 2 * 60 * 1000),
  },
  {
    id: "act-3",
    projectId: "proj-3",
    agentType: "developer",
    action: "Styled component",
    details: "Responsive header layout",
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
  },
  {
    id: "act-4",
    projectId: "proj-4",
    agentType: "developer",
    action: "Fixed bug",
    details: "Form validation error",
    timestamp: new Date(Date.now() - 8 * 60 * 1000),
  },
  {
    id: "act-5",
    projectId: "proj-3",
    agentType: "orchestrator",
    action: "Assigned task",
    details: "Build sidebar navigation",
    timestamp: new Date(Date.now() - 12 * 60 * 1000),
  },
];

export const mockStats: DashboardStats = {
  activeProjects: 4,
  activeAgents: 8,
  demosWaitingReview: 2,
  todaySpend: 47.2,
};

export function getProjectsByStatus(status: Project["status"]): Project[] {
  return mockProjects.filter((p) => p.status === status);
}

export function getAgentsByProject(projectId: string): Agent[] {
  return mockAgents.filter((a) => a.projectId === projectId);
}

export function getUnreadNotifications(): Notification[] {
  return mockNotifications.filter((n) => !n.read);
}
