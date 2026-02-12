import { Modal, Form, Input, Radio, message } from 'antd';
import { useEffect, useState } from 'react';
import type { Style } from '@/types';
import { useStyleStore } from '@/stores';

interface Props {
  open: boolean;
  style: Style | null;
  onClose: () => void;
}

/**
 * 编辑风格弹窗
 */
export function EditStyleModal({ open, style, onClose }: Props) {
  const updateStyle = useStyleStore((s) => s.updateStyle);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (style && open) {
      form.setFieldsValue({
        name: style.name,
        type: style.type,
        trigger_words: style.trigger_words ?? '',
      });
    }
  }, [style, open, form]);

  const handleOk = async () => {
    if (!style) return;
    try {
      const values = await form.validateFields();
      setLoading(true);
      await updateStyle(style.id, {
        name: values.name,
        type: values.type,
        trigger_words: values.trigger_words || null,
      });
      message.success('风格已更新');
      onClose();
    } catch {
      // 校验失败
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="编辑风格"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="风格名称"
          rules={[{ required: true, message: '请输入风格名称' }]}
        >
          <Input placeholder="输入风格名称" />
        </Form.Item>

        <Form.Item name="type" label="风格类型">
          <Radio.Group>
            <Radio.Button value="ui">UI 素材</Radio.Button>
            <Radio.Button value="vfx">VFX 特效</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item name="trigger_words" label="触发词">
          <Input placeholder="可选，用于生成时自动添加到提示词" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
