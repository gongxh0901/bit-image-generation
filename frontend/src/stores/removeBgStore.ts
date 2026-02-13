import { create } from 'zustand';
import type { RemoveBgTask } from '@/types';
import { submitRemoveBg } from '@/services/removeBg';

interface RemoveBgStore {
  /** 当前抠图任务 */
  currentTask: RemoveBgTask | null;
  /** 抠图历史结果 */
  results: RemoveBgTask[];
  /** 加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  submitRemoveBg: (inputImage: string, sourceTaskId?: number | null) => Promise<RemoveBgTask>;
  updateTaskProgress: (data: { id: number; status: string; progress?: number; output_paths?: string[] }) => void;
  clearError: () => void;
}

export const useRemoveBgStore = create<RemoveBgStore>((set, get) => ({
  currentTask: null,
  results: [],
  loading: false,
  error: null,

  submitRemoveBg: async (inputImage, sourceTaskId) => {
    set({ loading: true, error: null });
    try {
      const task = await submitRemoveBg({
        input_image: inputImage,
        source_task_id: sourceTaskId,
      });
      set({ currentTask: task, loading: false });
      return task;
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  updateTaskProgress: (data) => {
    const { currentTask } = get();
    if (currentTask && currentTask.id === data.id) {
      const updated = {
        ...currentTask,
        status: data.status as RemoveBgTask['status'],
        output_image: data.output_paths?.[0] ?? currentTask.output_image,
      };
      set({ currentTask: updated });

      if (data.status === 'completed') {
        set((state) => ({ results: [updated, ...state.results] }));
      }
    }
  },

  clearError: () => set({ error: null }),
}));
