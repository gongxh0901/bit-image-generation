import { Modal, Form, Input, Select, message } from 'antd';
import { useStyleStore } from '@/stores';
import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 创建风格弹窗
 */
export function CreateStyleModal({ open, onClose }: Props) {
  const [form] = Form.useForm();
  const createStyle = useStyleStore((s) => s.createStyle);
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await createStyle(values);
      message.success('风格创建成功');
      form.resetFields();
      onClose();
    } catch {
      // 表单校验失败不处理
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建新风格"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: 'ui' }}
        style={{ marginTop: 16 }}
      >
        <Form.Item
          name="name"
          label="风格名称"
          rules={[{ required: true, message: '请输入风格名称' }]}
        >
          <Input placeholder="例如：卡通 UI 风格 v1" />
        </Form.Item>

        <Form.Item name="type" label="类型" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'ui', label: 'UI 素材' },
              { value: 'vfx', label: 'VFX 特效' },
            ]}
          />
        </Form.Item>

        <Form.Item name="lora_path" label="LoRA 路径">
          <Input placeholder="models/loras/xxx.safetensors（可选）" />
        </Form.Item>

        <Form.Item name="trigger_words" label="触发词">
          <Input placeholder="cartoon, vivid（可选）" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
