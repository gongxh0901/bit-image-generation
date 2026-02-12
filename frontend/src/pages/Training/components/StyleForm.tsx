import { Form, Input, Radio, Typography } from 'antd';
import { useTrainingStore } from '@/stores';

const { Text } = Typography;

/**
 * 步骤 1: 基础信息表单
 */
export function StyleForm() {
  const { formData, updateFormData } = useTrainingStore();

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        设置训练风格的基本信息，中文名称便于后续识别和管理。
      </Text>

      <Form layout="vertical">
        <Form.Item
          label="风格名称"
          required
          help="使用中文名称便于识别，例如：卡通风格、像素风格"
        >
          <Input
            size="large"
            placeholder="输入风格名称"
            value={formData.styleName}
            onChange={(e) => updateFormData({ styleName: e.target.value })}
          />
        </Form.Item>

        <Form.Item
          label="风格类型"
          help="UI 素材用于界面元素（按钮、图标等），VFX 特效用于粒子效果、光效等"
        >
          <Radio.Group
            value={formData.styleType}
            onChange={(e) => updateFormData({ styleType: e.target.value })}
            size="large"
          >
            <Radio.Button value="ui">UI 素材</Radio.Button>
            <Radio.Button value="vfx">VFX 特效</Radio.Button>
          </Radio.Group>
        </Form.Item>
      </Form>
    </div>
  );
}
