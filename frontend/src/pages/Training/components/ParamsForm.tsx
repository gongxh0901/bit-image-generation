import { Form, InputNumber, Select, Typography, Divider } from 'antd';
import { useTrainingStore } from '@/stores';
import { TRAINING_PARAM_HINTS } from '@/types';
import type { TrainingParams } from '@/types';

const { Text } = Typography;

/**
 * 步骤 3: 训练参数配置
 */
export function ParamsForm() {
  const { formData, updateFormData } = useTrainingStore();
  const params = formData.params;

  const updateParam = <K extends keyof TrainingParams>(key: K, value: TrainingParams[K]) => {
    updateFormData({
      params: { ...params, [key]: value },
    });
  };

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        配置 LoRA 训练参数。如果不确定，使用默认值即可。
      </Text>

      <Form layout="vertical">
        <Form.Item
          label={TRAINING_PARAM_HINTS.batch_size.label}
          help={TRAINING_PARAM_HINTS.batch_size.hint}
        >
          <InputNumber
            size="large"
            min={TRAINING_PARAM_HINTS.batch_size.min}
            max={TRAINING_PARAM_HINTS.batch_size.max}
            step={TRAINING_PARAM_HINTS.batch_size.step}
            value={params.batch_size}
            onChange={(v) => updateParam('batch_size', v ?? 1)}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item
          label={TRAINING_PARAM_HINTS.learning_rate.label}
          help={TRAINING_PARAM_HINTS.learning_rate.hint}
        >
          <InputNumber
            size="large"
            min={TRAINING_PARAM_HINTS.learning_rate.min}
            max={TRAINING_PARAM_HINTS.learning_rate.max}
            step={TRAINING_PARAM_HINTS.learning_rate.step}
            value={params.learning_rate}
            onChange={(v) => updateParam('learning_rate', v ?? 0.0001)}
            style={{ width: '100%' }}
            stringMode
          />
        </Form.Item>

        <Form.Item
          label={TRAINING_PARAM_HINTS.max_train_steps.label}
          help={TRAINING_PARAM_HINTS.max_train_steps.hint}
        >
          <InputNumber
            size="large"
            min={TRAINING_PARAM_HINTS.max_train_steps.min}
            max={TRAINING_PARAM_HINTS.max_train_steps.max}
            step={TRAINING_PARAM_HINTS.max_train_steps.step}
            value={params.max_train_steps}
            onChange={(v) => updateParam('max_train_steps', v ?? 1000)}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item
          label={TRAINING_PARAM_HINTS.resolution.label}
          help={TRAINING_PARAM_HINTS.resolution.hint}
        >
          <Select
            size="large"
            value={params.resolution}
            onChange={(v) => updateParam('resolution', v)}
            options={[
              { value: 512, label: '512 × 512' },
              { value: 768, label: '768 × 768' },
              { value: 1024, label: '1024 × 1024（推荐）' },
            ]}
          />
        </Form.Item>

        <Divider />

        <Form.Item
          label={TRAINING_PARAM_HINTS.save_every_n_steps.label}
          help={TRAINING_PARAM_HINTS.save_every_n_steps.hint}
        >
          <InputNumber
            size="large"
            min={TRAINING_PARAM_HINTS.save_every_n_steps.min}
            max={TRAINING_PARAM_HINTS.save_every_n_steps.max}
            step={TRAINING_PARAM_HINTS.save_every_n_steps.step}
            value={params.save_every_n_steps}
            onChange={(v) => updateParam('save_every_n_steps', v ?? 500)}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </div>
  );
}
