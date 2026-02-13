import { Descriptions, Tag, Typography, Alert } from 'antd';
import { useTrainingStore } from '@/stores';

const { Text } = Typography;

/**
 * 步骤 4: 确认提交
 */
export function TrainingConfirm() {
  const { formData } = useTrainingStore();
  const { styleName, styleType, datasetFiles, params } = formData;

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        请确认以下训练配置，确认无误后点击「开始训练」。
      </Text>

      <Alert
        type="warning"
        showIcon
        message="训练提示"
        description="训练过程可能需要较长时间，请确保系统资源充足。训练期间请勿关闭服务。"
        style={{ marginBottom: 20 }}
      />

      <Descriptions
        bordered
        column={1}
        size="middle"
        labelStyle={{ width: 120, color: 'var(--text-secondary)' }}
      >
        <Descriptions.Item label="风格名称">
          <Text strong>{styleName || '（未填写）'}</Text>
        </Descriptions.Item>

        <Descriptions.Item label="风格类型">
          <Tag color={styleType === 'ui' ? 'blue' : 'volcano'}>
            {styleType === 'ui' ? 'UI 素材' : 'VFX 特效'}
          </Tag>
        </Descriptions.Item>

        <Descriptions.Item label="素材数量">
          <Text>{datasetFiles.length} 张图片</Text>
        </Descriptions.Item>

        <Descriptions.Item label="LoRA Rank">
          <Text>{params.lora_rank}</Text>
        </Descriptions.Item>

        <Descriptions.Item label="学习率">
          <Text>{params.learning_rate}</Text>
        </Descriptions.Item>

        <Descriptions.Item label="训练步数">
          <Text>{params.steps}</Text>
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}
