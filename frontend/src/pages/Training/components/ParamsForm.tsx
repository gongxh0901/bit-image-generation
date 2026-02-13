import { Form, InputNumber, Typography } from 'antd';
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
          label={TRAINING_PARAM_HINTS.lora_rank.label}
          help={TRAINING_PARAM_HINTS.lora_rank.hint}
        >
          <InputNumber
            size="large"
            min={TRAINING_PARAM_HINTS.lora_rank.min}
            max={TRAINING_PARAM_HINTS.lora_rank.max}
            step={TRAINING_PARAM_HINTS.lora_rank.step}
            value={params.lora_rank}
            onChange={(v) => updateParam('lora_rank', v ?? 16)}
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
          label={TRAINING_PARAM_HINTS.steps.label}
          help={TRAINING_PARAM_HINTS.steps.hint}
        >
          <InputNumber
            size="large"
            min={TRAINING_PARAM_HINTS.steps.min}
            max={TRAINING_PARAM_HINTS.steps.max}
            step={TRAINING_PARAM_HINTS.steps.step}
            value={params.steps}
            onChange={(v) => updateParam('steps', v ?? 1000)}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </div>
  );
}
