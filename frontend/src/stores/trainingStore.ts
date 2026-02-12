import { create } from 'zustand';
import type { TrainingJob, TrainingParams } from '@/types';
import { submitTraining } from '@/services/training';

interface TrainingFormData {
  styleName: string;
  styleType: 'ui' | 'vfx';
  datasetFiles: File[];
  params: TrainingParams;
}

interface TrainingStore {
  /** 当前表单步骤 (0-3) */
  currentStep: number;
  /** 表单数据 */
  formData: TrainingFormData;
  /** 进行中的训练任务 */
  activeJobs: TrainingJob[];
  /** 提交中 */
  submitting: boolean;
  /** 错误信息 */
  error: string | null;

  // Actions
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  updateFormData: (data: Partial<TrainingFormData>) => void;
  submitTraining: () => Promise<TrainingJob>;
  updateJobProgress: (data: { id: number; status: string; progress?: number }) => void;
  resetForm: () => void;
  clearError: () => void;
}

const defaultParams: TrainingParams = {
  batch_size: 1,
  learning_rate: 0.0001,
  max_train_steps: 1000,
  resolution: 1024,
  save_every_n_steps: 500,
};

const defaultFormData: TrainingFormData = {
  styleName: '',
  styleType: 'ui',
  datasetFiles: [],
  params: { ...defaultParams },
};

export const useTrainingStore = create<TrainingStore>((set, get) => ({
  currentStep: 0,
  formData: { ...defaultFormData },
  activeJobs: [],
  submitting: false,
  error: null,

  setStep: (step) => set({ currentStep: step }),
  nextStep: () => set((s) => ({ currentStep: Math.min(s.currentStep + 1, 3) })),
  prevStep: () => set((s) => ({ currentStep: Math.max(s.currentStep - 1, 0) })),

  updateFormData: (data) => {
    set((s) => ({ formData: { ...s.formData, ...data } }));
  },

  submitTraining: async () => {
    set({ submitting: true, error: null });
    try {
      const { formData } = get();
      const job = await submitTraining({
        style_name: formData.styleName,
        style_type: formData.styleType,
        dataset_path: `datasets/${formData.styleName}`,
        params: formData.params,
      });
      set((s) => ({
        submitting: false,
        activeJobs: [job, ...s.activeJobs],
      }));
      return job;
    } catch (e) {
      set({ submitting: false, error: (e as Error).message });
      throw e;
    }
  },

  updateJobProgress: (data) => {
    set((s) => ({
      activeJobs: s.activeJobs.map((job) =>
        job.id === data.id
          ? {
              ...job,
              status: data.status as TrainingJob['status'],
              progress: data.progress ?? job.progress,
            }
          : job,
      ),
    }));
  },

  resetForm: () => {
    set({ currentStep: 0, formData: { ...defaultFormData }, error: null });
  },

  clearError: () => set({ error: null }),
}));
