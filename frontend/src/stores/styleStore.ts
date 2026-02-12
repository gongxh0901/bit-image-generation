import { create } from 'zustand';
import type { Style } from '@/types';
import { fetchStyles, createStyle as apiCreateStyle } from '@/services/style';

interface StyleStore {
  /** 风格列表 */
  styles: Style[];
  /** 当前选中的风格 ID */
  selectedStyleId: number | null;
  /** 正在生成中的风格 ID 集合 */
  generatingStyleIds: Set<number>;
  /** 加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  // Actions
  fetchStyles: () => Promise<void>;
  selectStyle: (id: number) => void;
  setGenerating: (id: number, isGenerating: boolean) => void;
  clearError: () => void;
  createStyle: (payload: Parameters<typeof apiCreateStyle>[0]) => Promise<Style>;
}

export const useStyleStore = create<StyleStore>((set, get) => ({
  styles: [],
  selectedStyleId: null,
  generatingStyleIds: new Set(),
  loading: false,
  error: null,

  fetchStyles: async () => {
    set({ loading: true, error: null });
    try {
      const styles = await fetchStyles();
      set({ styles, loading: false });
      // 自动选中第一个
      if (!get().selectedStyleId && styles.length > 0) {
        set({ selectedStyleId: styles[0].id });
      }
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  selectStyle: (id) => {
    set({ selectedStyleId: id });
  },

  setGenerating: (id, isGenerating) => {
    const next = new Set(get().generatingStyleIds);
    if (isGenerating) {
      next.add(id);
    } else {
      next.delete(id);
    }
    set({ generatingStyleIds: next });
  },

  clearError: () => set({ error: null }),

  createStyle: async (payload) => {
    const style = await apiCreateStyle(payload);
    set((state) => ({ styles: [style, ...state.styles] }));
    return style;
  },
}));
