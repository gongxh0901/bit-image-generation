import { create } from 'zustand';
import type { Style } from '@/types';
import {
  fetchStyles,
  createStyle as apiCreateStyle,
  updateStyle as apiUpdateStyle,
  deleteStyle as apiDeleteStyle,
  type StyleUpdatePayload,
} from '@/services/style';

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
  updateStyle: (id: number, payload: StyleUpdatePayload) => Promise<Style>;
  deleteStyle: (id: number) => Promise<void>;
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
      const rawStyles = await fetchStyles();
      // 基础风格置顶排序
      const sorted = [...rawStyles].sort((a, b) => {
        if (a.is_base && !b.is_base) return -1;
        if (!a.is_base && b.is_base) return 1;
        return 0;
      });
      set({ styles: sorted, loading: false });
      // 优先选中基础风格，否则选中第一个
      if (!get().selectedStyleId && sorted.length > 0) {
        const base = sorted.find((s) => s.is_base);
        set({ selectedStyleId: base ? base.id : sorted[0].id });
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

  updateStyle: async (id, payload) => {
    const updated = await apiUpdateStyle(id, payload);
    set((state) => ({
      styles: state.styles.map((s) => (s.id === id ? updated : s)),
    }));
    return updated;
  },

  deleteStyle: async (id) => {
    await apiDeleteStyle(id);
    set((state) => {
      const styles = state.styles.filter((s) => s.id !== id);
      const selectedStyleId =
        state.selectedStyleId === id
          ? styles.length > 0
            ? styles[0].id
            : null
          : state.selectedStyleId;
      return { styles, selectedStyleId };
    });
  },
}));
