import {
  Card,
  Form,
  Input,
  Select,
  Button,
  Upload,
  Progress,
  Typography,
  Space,
  InputNumber,
  message,
  Tag,
  Image,
} from 'antd';
import {
  SendOutlined,
  InboxOutlined,
  PictureOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { useState } from 'react';
import { useStyleStore, useGenerationStore } from '@/stores';
import { getStatusInfo } from '@/utils/format';
import { uploadImage } from '@/services/upload';
import styles from './GenerationPanel.module.css';

const { TextArea } = Input;
const { Text, Title } = Typography;
const { Dragger } = Upload;

/**
 * 中间栏 - 生成操作面板
 */
export function GenerationPanel() {
  const selectedStyleId = useStyleStore((s) => s.selectedStyleId);
  const styleList = useStyleStore((s) => s.styles);
  const setGenerating = useStyleStore((s) => s.setGenerating);

  const currentTask = useGenerationStore((s) => s.currentTask);
  const submit = useGenerationStore((s) => s.submitGeneration);
  const loading = useGenerationStore((s) => s.loading);

  const [form] = Form.useForm();
  const [_fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const selectedStyle = styleList.find((s) => s.id === selectedStyleId);

  const isRunning = currentTask?.status === 'queued' || currentTask?.status === 'running';

  /** 处理图片上传 */
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadImage(file);
      setUploadedImageUrl(result.url);
      message.success('图片上传成功');
      // 自动切换到 img2img 模式
      form.setFieldValue('type', 'img2img');
    } catch {
      message.error('图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  /** 移除已上传的图片 */
  const handleRemoveImage = () => {
    setUploadedImageUrl(null);
    setFileList([]);
    form.setFieldValue('type', 'txt2img');
  };

  const handleSubmit = async () => {
    if (!selectedStyleId) {
      message.warning('请先在左侧选择一个风格');
      return;
    }
    try {
      const values = await form.validateFields();
      const genType = values.type as 'txt2img' | 'img2img';

      // img2img 模式必须上传参考图
      if (genType === 'img2img' && !uploadedImageUrl) {
        message.warning('图生图模式需要上传参考图片');
        return;
      }

      setGenerating(selectedStyleId, true);
      await submit({
        styleId: selectedStyleId,
        prompt: values.prompt,
        type: genType,
        inputImage: genType === 'img2img' ? uploadedImageUrl : undefined,
      });
      message.success('生成任务已提交');
    } catch {
      // 校验失败或提交失败
    }
  };

  // 未选中风格时的空状态
  if (!selectedStyleId || !selectedStyle) {
    return (
      <div className={styles.empty}>
        <PictureOutlined className={styles.emptyIcon} />
        <Title level={5} className={styles.emptyTitle}>
          选择风格开始生成
        </Title>
        <Text type="secondary">从左侧风格列表选择一个风格，配置参数后开始生成游戏素材</Text>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* 当前风格信息 */}
      <div className={styles.styleInfo}>
        <Space>
          <Tag color="blue">{selectedStyle.type.toUpperCase()}</Tag>
          <Text strong>{selectedStyle.name}</Text>
        </Space>
        {selectedStyle.trigger_words && (
          <Text type="secondary" className={styles.triggerWords}>
            触发词: {selectedStyle.trigger_words}
          </Text>
        )}
      </div>

      {/* 生成表单 */}
      <Card className={styles.formCard} bordered={false}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ type: 'txt2img', numImages: 1 }}
          disabled={isRunning}
        >
          {/* 任务类型 */}
          <Form.Item name="type" label="生成模式">
            <Select
              options={[
                { value: 'txt2img', label: '文生图 (txt2img)' },
                { value: 'img2img', label: '图生图 (img2img)' },
              ]}
            />
          </Form.Item>

          {/* 参考图上传 */}
          <Form.Item label="参考图片（可选）">
            {uploadedImageUrl ? (
              <div className={styles.uploadedPreview}>
                <Image
                  src={uploadedImageUrl}
                  alt="参考图"
                  width={120}
                  height={120}
                  style={{ objectFit: 'cover', borderRadius: 8 }}
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  size="small"
                  onClick={handleRemoveImage}
                  className={styles.removeBtn}
                >
                  移除
                </Button>
              </div>
            ) : (
              <Dragger
                accept="image/jpeg,image/png,image/webp"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  handleUpload(file);
                  return false;
                }}
                onChange={({ fileList }) => setFileList(fileList)}
                className={styles.uploader}
                disabled={uploading}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">
                  {uploading ? '上传中...' : '点击或拖拽上传参考图片'}
                </p>
                <p className="ant-upload-hint">支持 JPG / PNG / WebP，最大 10MB</p>
              </Dragger>
            )}
          </Form.Item>

          {/* 提示词 */}
          <Form.Item
            name="prompt"
            label="提示词"
            rules={[{ required: true, message: '请输入提示词' }]}
          >
            <TextArea
              rows={4}
              placeholder="输入中文或英文提示词，例如：奇幻游戏 UI 图标，发光宝石，高清细节"
              maxLength={1000}
              showCount
              className={styles.prompt}
            />
          </Form.Item>

          {/* 生成数量 */}
          <Form.Item name="numImages" label="生成数量">
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
        </Form>

        {/* 提交按钮 */}
        <Button
          type="primary"
          icon={<SendOutlined />}
          size="large"
          block
          loading={loading || isRunning}
          onClick={handleSubmit}
          className={styles.submitBtn}
        >
          {isRunning ? '生成中...' : '开始生成'}
        </Button>
      </Card>

      {/* 进度显示 */}
      {currentTask && isRunning && (
        <Card className={styles.progressCard} bordered={false}>
          <div className={styles.progressHeader}>
            <Text strong>生成进度</Text>
            <Tag color={getStatusInfo(currentTask.status).color}>
              {getStatusInfo(currentTask.status).label}
            </Tag>
          </div>
          <Progress
            percent={0}
            status="active"
            strokeColor={{
              '0%': '#3b82f6',
              '100%': '#22c55e',
            }}
          />
          <Text type="secondary" className={styles.progressHint}>
            任务 #{currentTask.id} · {currentTask.type === 'txt2img' ? '文生图' : '图生图'}
          </Text>
        </Card>
      )}

      {/* 最近完成 */}
      {currentTask && currentTask.status === 'completed' && (
        <Card className={styles.progressCard} bordered={false}>
          <div className={styles.progressHeader}>
            <Text strong>最近完成</Text>
            <Tag color="success">已完成</Tag>
          </div>
          <Text type="secondary">
            任务 #{currentTask.id} · 生成了 {currentTask.output_paths.length} 张图片
          </Text>
        </Card>
      )}
    </div>
  );
}
