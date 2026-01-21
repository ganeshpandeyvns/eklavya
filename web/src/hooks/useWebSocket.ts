'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getWebSocketClient, WebSocketStatus, WebSocketMessage } from '@/lib/websocket';

/**
 * Hook for WebSocket connection and real-time updates
 */
export function useWebSocket(options?: {
  autoConnect?: boolean;
  channels?: string[];
  projectId?: string;
}): {
  status: WebSocketStatus;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  subscribe: (channels: string[], projectId?: string) => void;
} {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const clientRef = useRef(getWebSocketClient({ onStatusChange: setStatus }));

  useEffect(() => {
    const client = clientRef.current;

    if (options?.autoConnect !== false) {
      client.connect();
    }

    if (options?.channels || options?.projectId) {
      client.subscribe({
        channels: options.channels,
        projectId: options.projectId,
      });
    }

    return () => {
      // Don't disconnect on unmount - keep connection alive
    };
  }, [options?.autoConnect, options?.channels, options?.projectId]);

  const connect = useCallback(() => {
    clientRef.current.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current.disconnect();
  }, []);

  const subscribe = useCallback((channels: string[], projectId?: string) => {
    clientRef.current.subscribe({ channels, projectId });
  }, []);

  return {
    status,
    isConnected: status === 'connected',
    connect,
    disconnect,
    subscribe,
  };
}

/**
 * Hook for subscribing to specific WebSocket message types
 */
export function useWebSocketMessage<T = unknown>(
  type: string,
  callback: (payload: T) => void
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const client = getWebSocketClient();

    const handler = (message: WebSocketMessage) => {
      callbackRef.current(message.payload as T);
    };

    const unsubscribe = client.on(type, handler);

    return () => {
      unsubscribe();
    };
  }, [type]);
}

/**
 * Hook for real-time agent updates
 */
export function useAgentUpdates(
  projectId: string | null,
  onUpdate: (agent: {
    id: string;
    projectId: string;
    type: string;
    status: string;
    currentTask?: string;
    progress?: number;
  }) => void
): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!projectId) return;

    const client = getWebSocketClient();

    // Subscribe to agents channel for this project
    client.subscribe({ channels: ['agents'], projectId });

    const unsubscribe = client.on('agent:updated', (message) => {
      const agent = message.payload as {
        id: string;
        projectId: string;
        type: string;
        status: string;
        currentTask?: string;
        progress?: number;
        channel: string;
      };

      if (agent.projectId === projectId) {
        onUpdateRef.current(agent);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [projectId]);
}

/**
 * Hook for real-time task updates
 */
export function useTaskUpdates(
  projectId: string | null,
  onUpdate: (task: {
    id: string;
    projectId: string;
    title: string;
    status: string;
    progress?: number;
    assignedAgentId?: string;
  }) => void
): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!projectId) return;

    const client = getWebSocketClient();

    client.subscribe({ channels: ['tasks'], projectId });

    const unsubscribe = client.on('task:updated', (message) => {
      const task = message.payload as {
        id: string;
        projectId: string;
        title: string;
        status: string;
        progress?: number;
        assignedAgentId?: string;
        channel: string;
      };

      if (task.projectId === projectId) {
        onUpdateRef.current(task);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [projectId]);
}

/**
 * Hook for real-time activity feed updates
 */
export function useActivityUpdates(
  projectId: string | null,
  onNewActivity: (activity: {
    id: string;
    projectId: string;
    agentType: string;
    action: string;
    details?: string;
  }) => void
): void {
  const onNewActivityRef = useRef(onNewActivity);
  onNewActivityRef.current = onNewActivity;

  useEffect(() => {
    if (!projectId) return;

    const client = getWebSocketClient();

    client.subscribe({ channels: ['activity'], projectId });

    const unsubscribe = client.on('activity:new', (message) => {
      const activity = message.payload as {
        id: string;
        projectId: string;
        agentType: string;
        action: string;
        details?: string;
        channel: string;
      };

      if (activity.projectId === projectId) {
        onNewActivityRef.current(activity);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [projectId]);
}

/**
 * Hook for RL learning updates
 */
export function useLearningUpdates(
  onUpdate: (update: {
    promptId: string;
    agentType: string;
    outcome: string;
    reward: number;
    thompsonScore: number;
  }) => void
): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const client = getWebSocketClient();

    client.subscribe({ channels: ['learning'] });

    const unsubscribe = client.on('learning:updated', (message) => {
      const update = message.payload as {
        promptId: string;
        agentType: string;
        outcome: string;
        reward: number;
        thompsonScore: number;
        channel: string;
      };

      onUpdateRef.current(update);
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
