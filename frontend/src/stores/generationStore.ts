import { create } from 'zustand';
import type { GenerationTask, GenerationResult, ControlNetConfig } from '@/types';
import { submitGeneration, previewControlNet } from '@/services/generation';

interface GenerationStore {
  /** 当前活跃的生成任务 */
  currentTask: GenerationTask | null;
  /** 按风格 ID 分组的历史生成结果 */
  history: Record<number, GenerationResult[]>;
  /** 当前选中的图片 URL 集合（用于批量下载） */
  selectedImages: Set<string>;
  /** 加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 批量进度信息 */
  currentFrame: number;
  totalFrames: number;
  frameProgress: number;

  /** ControlNet 预览图 URL */
  controlNetPreviewUrl: string | null;
  controlNetPreviewLoading: boolean;

  // Actions
  submitGeneration: (params: {
    styleId: number;
    prompt: string;
    type: 'txt2img' | 'img2img';
    inputImage?: string | null;
    negativePrompt?: string;
    seed?: number | null;
    useTransparency?: boolean;
    batchSize?: number;
    controlnet?: ControlNetConfig | null;
  }) => Promise<GenerationTask>;

  updateTaskProgress: (data: {
    id: number;
    status: string;
    progress?: number;
    current_frame?: number;
    total_frames?: number;
    frame_progress?: number;
    output_paths?: string[];
  }) => void;

  addToHistory: (styleId: number, results: GenerationResult[]) => void;

  /** ControlNet 预处理预览 */
  fetchControlNetPreview: (file: File, controlType: string) => Promise<void>;
  clearControlNetPreview: () => void;

  // 图片选择
  toggleImageSelection: (url: string) => void;
  selectAllImages: (urls: string[]) => void;
  clearSelection: () => void;

  clearError: () => void;
}

export const useGenerationStore = create<GenerationStore>((set, get) => ({
  currentTask: null,
  history: {},
  selectedImages: new Set(),
  loading: false,
  error: null,
  currentFrame: 0,
  totalFrames: 0,
  frameProgress: 0,
  controlNetPreviewUrl: null,
  controlNetPreviewLoading: false,

  submitGeneration: async ({
    styleId,
    prompt,
    type,
    inputImage,
    negativePrompt,
    seed,
    useTransparency,
    batchSize,
    controlnet,
  }) => {
    set({ loading: true, error: null, currentFrame: 0, totalFrames: batchSize ?? 1, frameProgress: 0 });
    try {
      const task = await submitGeneration({
        style_id: styleId,
        type,
        prompt,
        negative_prompt: negativePrompt,
        input_image: inputImage ?? undefined,
        seed: seed ?? undefined,
        use_transparency: useTransparency,
        batch_size: batchSize,
        controlnet: controlnet ?? undefined,
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
      set({
        currentTask: {
          ...currentTask,
          status: data.status as GenerationTask['status'],
          output_paths: data.output_paths ?? currentTask.output_paths,
        },
        currentFrame: data.current_frame ?? get().currentFrame,
        totalFrames: data.total_frames ?? get().totalFrames,
        frameProgress: data.frame_progress ?? get().frameProgress,
      });
    }

    // 任务完成或部分完成时，将结果添加到历史
    if ((data.status === 'completed' || data.status === 'partial') && data.output_paths && currentTask) {
      const styleId = currentTask.style_id ?? 0;
      const results: GenerationResult[] = data.output_paths.map((p, i) => ({
        id: `${data.id}-${i}`,
        taskId: data.id,
        imageUrl: p,
        filename: p.split('/').pop() ?? `image-${i}.png`,
        createdAt: new Date().toISOString(),
      }));
      get().addToHistory(styleId, results);
    }
  },

  addToHistory: (styleId, results) => {
    set((state) => ({
      history: {
        ...state.history,
        [styleId]: [...results, ...(state.history[styleId] ?? [])],
      },
    }));
  },

  fetchControlNetPreview: async (file, controlType) => {
    set({ controlNetPreviewLoading: true, controlNetPreviewUrl: null });
    try {
      const result = await previewControlNet(file, controlType);
      set({ controlNetPreviewUrl: result.preview_url, controlNetPreviewLoading: false });
    } catch {
      set({ controlNetPreviewLoading: false });
    }
  },

  clearControlNetPreview: () => {
    set({ controlNetPreviewUrl: null });
  },

  toggleImageSelection: (url) => {
    const next = new Set(get().selectedImages);
    if (next.has(url)) {
      next.delete(url);
    } else {
      next.add(url);
    }
    set({ selectedImages: next });
  },

  selectAllImages: (urls) => {
    set({ selectedImages: new Set(urls) });
  },

  clearSelection: () => {
    set({ selectedImages: new Set() });
  },

  clearError: () => set({ error: null }),
}));
