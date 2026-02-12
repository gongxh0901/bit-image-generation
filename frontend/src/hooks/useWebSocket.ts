import { useEffect, useRef, useState, useCallback } from 'react';
import type { WSProgressMessage } from '@/types';
import { useGenerationStore } from '@/stores/generationStore';
import { useTrainingStore } from '@/stores/trainingStore';
import { useStyleStore } from '@/stores/styleStore';

/** WebSocket 连接状态 */
export type WSStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * WebSocket 全局连接 Hook
 * 自动连接、断线重连、消息分发到对应 Store
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<WSStatus>('disconnected');

  const connect = useCallback(() => {
    // 构建 WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/progress`;

    setStatus('connecting');
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus('connected');
      console.log('[WS] 已连接');
    };

    ws.onmessage = (event) => {
      try {
        const data: WSProgressMessage = JSON.parse(event.data);

        switch (data.kind) {
          case 'generation':
            useGenerationStore.getState().updateTaskProgress(data);
            if (data.status === 'completed' || data.status === 'failed') {
              // 获取当前任务的 style_id
              const task = useGenerationStore.getState().currentTask;
              if (task?.style_id) {
                useStyleStore.getState().setGenerating(task.style_id, false);
              }
            }
            break;

          case 'training':
            useTrainingStore.getState().updateJobProgress(data);
            break;
        }
      } catch (e) {
        console.warn('[WS] 消息解析失败:', e);
      }
    };

    ws.onclose = () => {
      setStatus('disconnected');
      console.log('[WS] 断开连接，3 秒后重连...');
      reconnectTimerRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      // onclose 会随后触发
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    // Ping 保活
    const pingTimer = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, 5000);

    return () => {
      clearInterval(pingTimer);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { status };
}
