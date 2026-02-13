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
  Slider,
  Collapse,
  Spin,
  Popover,
} from 'antd';
import {
  SendOutlined,
  InboxOutlined,
  PictureOutlined,
  DeleteOutlined,
  ControlOutlined,
  EyeInvisibleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { useState } from 'react';
import { useStyleStore, useGenerationStore } from '@/stores';
import type { ControlNetConfig } from '@/types';
import { getStatusInfo } from '@/utils/format';
import { uploadImage } from '@/services/upload';
import styles from './GenerationPanel.module.css';

const { TextArea } = Input;
const { Text, Title } = Typography;
const { Dragger } = Upload;

/** ControlNet 类型选项 */
const CONTROLNET_TYPE_OPTIONS = [
  { value: 'canny', label: 'Canny（边缘检测）' },
  { value: 'depth', label: 'Depth（深度图）' },
  { value: 'tile', label: 'Tile（细节增强）' },
  { value: 'blur', label: 'Blur（模糊引导）' },
  { value: 'pose', label: 'Pose（姿态控制）' },
];

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
  const currentFrame = useGenerationStore((s) => s.currentFrame);
  const totalFrames = useGenerationStore((s) => s.totalFrames);
  const frameProgress = useGenerationStore((s) => s.frameProgress);
  const controlNetPreviewUrl = useGenerationStore((s) => s.controlNetPreviewUrl);
  const controlNetPreviewLoading = useGenerationStore((s) => s.controlNetPreviewLoading);
  const fetchControlNetPreview = useGenerationStore((s) => s.fetchControlNetPreview);
  const clearControlNetPreview = useGenerationStore((s) => s.clearControlNetPreview);

  const [form] = Form.useForm();
  const [_fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // ControlNet 状态
  const [cnEnabled, setCnEnabled] = useState(false);
  const [cnType, setCnType] = useState<'canny' | 'depth' | 'tile' | 'blur' | 'pose'>('canny');
  const [cnImageUrl, setCnImageUrl] = useState<string | null>(null);
  const [cnImageFile, setCnImageFile] = useState<File | null>(null);
  const [cnStrength, setCnStrength] = useState(1.0);
  const [cnUploading, setCnUploading] = useState(false);

  const selectedStyle = styleList.find((s) => s.id === selectedStyleId);

  const isRunning = currentTask?.status === 'queued' || currentTask?.status === 'running';

  /** 处理参考图上传 */
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadImage(file);
      setUploadedImageUrl(result.url);
      message.success('图片上传成功');
      form.setFieldValue('type', 'img2img');
    } catch {
      message.error('图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  /** 移除已上传的参考图 */
  const handleRemoveImage = () => {
    setUploadedImageUrl(null);
    setFileList([]);
    form.setFieldValue('type', 'txt2img');
  };

  /** 处理 ControlNet 图片上传 */
  const handleCnUpload = async (file: File) => {
    setCnUploading(true);
    try {
      const result = await uploadImage(file);
      setCnImageUrl(result.url);
      setCnImageFile(file);
      message.success('控制图上传成功');
      // 自动请求预处理预览
      fetchControlNetPreview(file, cnType);
    } catch {
      message.error('控制图上传失败');
    } finally {
      setCnUploading(false);
    }
  };

  /** 移除 ControlNet 控制图 */
  const handleCnRemoveImage = () => {
    setCnImageUrl(null);
    setCnImageFile(null);
    clearControlNetPreview();
  };

  /** ControlNet 类型切换时重新预览 */
  const handleCnTypeChange = (value: 'canny' | 'depth' | 'tile' | 'blur' | 'pose') => {
    setCnType(value);
    if (cnImageFile) {
      fetchControlNetPreview(cnImageFile, value);
    }
  };

  const handleSubmit = async () => {
    if (!selectedStyleId) {
      message.warning('请先在左侧选择一个风格');
      return;
    }
    try {
      const values = await form.validateFields();
      const genType = values.type as 'txt2img' | 'img2img';

      if (genType === 'img2img' && !uploadedImageUrl) {
        message.warning('图生图模式需要上传参考图片');
        return;
      }

      // 构建 ControlNet 配置
      let controlnet: ControlNetConfig | null = null;
      if (cnEnabled && cnImageUrl) {
        controlnet = {
          enabled: true,
          type: cnType,
          image: cnImageUrl,
          strength: cnStrength,
        };
      }

      setGenerating(selectedStyleId, true);
      await submit({
        styleId: selectedStyleId,
        prompt: values.prompt,
        type: genType,
        inputImage: genType === 'img2img' ? uploadedImageUrl : undefined,
        negativePrompt: values.negativePrompt,
        seed: values.seed || null,
        batchSize: values.batchSize ?? 1,
        controlnet,
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
          initialValues={{
            type: 'txt2img',
            batchSize: 1,
            negativePrompt: 'ugly, blurry, low quality, watermark, text',
          }}
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

          {/* 反向提示词（可折叠） */}
          <Collapse
            ghost
            size="small"
            className={styles.advancedCollapse}
            items={[
              {
                key: 'negative',
                label: (
                  <Space size={4}>
                    <EyeInvisibleOutlined />
                    <span>反向提示词</span>
                  </Space>
                ),
                children: (
                  <Form.Item name="negativePrompt" noStyle>
                    <TextArea
                      rows={2}
                      placeholder="不希望出现的内容"
                      maxLength={500}
                      className={styles.prompt}
                    />
                  </Form.Item>
                ),
              },
            ]}
          />

          {/* Seed */}
          <Form.Item name="seed" label="Seed（可选）">
            <InputNumber
              min={0}
              max={4294967295}
              placeholder="留空随机"
              style={{ width: '100%' }}
            />
          </Form.Item>

          {/* 批量变体数量 */}
          <Form.Item name="batchSize" label="批量变体数量">
            <Slider
              min={1}
              max={32}
              marks={{ 1: '1', 4: '4', 8: '8', 16: '16', 32: '32' }}
            />
          </Form.Item>

          {/* ControlNet 面板 */}
          <Collapse
            ghost
            size="small"
            className={styles.advancedCollapse}
            items={[
              {
                key: 'controlnet',
                label: (
                  <Space size={4}>
                    <ControlOutlined />
                    <span>ControlNet 控制</span>
                    <Popover
                      placement="right"
                      title="ControlNet 控制说明"
                      content={
                        <div style={{ maxWidth: 320 }}>
                          <Typography.Paragraph style={{ marginBottom: 12 }}>
                            <strong>精确控制生成图片的结构和形状</strong>，而不仅仅依赖文字描述。
                          </Typography.Paragraph>
                          
                          <Typography.Title level={5} style={{ fontSize: 13, marginTop: 12, marginBottom: 8 }}>
                            五种控制类型
                          </Typography.Title>
                          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 4 }}>
                            <strong>• Canny（边缘）</strong>：提取清晰的线条边缘<br />
                            <Text type="secondary" style={{ fontSize: 11 }}>适用：线稿、轮廓图 → 精细游戏图标</Text>
                          </Typography.Paragraph>
                          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 4 }}>
                            <strong>• Depth（深度）</strong>：提取空间深度信息<br />
                            <Text type="secondary" style={{ fontSize: 11 }}>适用：控制物体的前后层次、3D 感</Text>
                          </Typography.Paragraph>
                          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 4 }}>
                            <strong>• Tile（细节）</strong>：增强图片细节<br />
                            <Text type="secondary" style={{ fontSize: 11 }}>适用：超分辨率、细节补充</Text>
                          </Typography.Paragraph>
                          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 4 }}>
                            <strong>• Blur（模糊）</strong>：模糊引导生成<br />
                            <Text type="secondary" style={{ fontSize: 11 }}>适用：色块参考 → 风格化素材</Text>
                          </Typography.Paragraph>
                          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 12 }}>
                            <strong>• Pose（姿态）</strong>：检测人物关键点<br />
                            <Text type="secondary" style={{ fontSize: 11 }}>适用：角色姿态控制 → 游戏角色</Text>
                          </Typography.Paragraph>

                          <Typography.Title level={5} style={{ fontSize: 13, marginTop: 12, marginBottom: 8 }}>
                            使用示例
                          </Typography.Title>
                          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0 }}>
                            <Text type="secondary">• 图标生成：简单涂鸦 → 精美水晶剑图标</Text><br />
                            <Text type="secondary">• 角色素材：姿态控制 → 游戏角色</Text><br />
                            <Text type="secondary">• VFX 特效：模糊引导 → 可直接使用的魔法特效</Text>
                          </Typography.Paragraph>
                        </div>
                      }
                      trigger="click"
                    >
                      <InfoCircleOutlined 
                        style={{ 
                          fontSize: 14, 
                          color: '#1890ff',
                          cursor: 'pointer',
                          marginLeft: 4
                        }} 
                      />
                    </Popover>
                    {cnEnabled && <Tag color="blue" style={{ marginLeft: 4 }}>已启用</Tag>}
                  </Space>
                ),
                children: (
                  <div className={styles.controlNetPanel}>
                    {/* 开关 */}
                    <div className={styles.cnRow}>
                      <Text>启用 ControlNet</Text>
                      <Button
                        type={cnEnabled ? 'primary' : 'default'}
                        size="small"
                        onClick={() => setCnEnabled(!cnEnabled)}
                      >
                        {cnEnabled ? '已启用' : '点击启用'}
                      </Button>
                    </div>

                    {cnEnabled && (
                      <>
                        {/* 类型选择 */}
                        <div className={styles.cnField}>
                          <Text type="secondary" className={styles.cnLabel}>控制类型</Text>
                          <Select
                            value={cnType}
                            onChange={handleCnTypeChange}
                            options={CONTROLNET_TYPE_OPTIONS}
                            style={{ width: '100%' }}
                          />
                        </div>

                        {/* 控制图上传 */}
                        <div className={styles.cnField}>
                          <Text type="secondary" className={styles.cnLabel}>控制图</Text>
                          {cnImageUrl ? (
                            <div className={styles.cnPreviewRow}>
                              <div className={styles.cnImagePair}>
                                <div className={styles.cnImageBox}>
                                  <Text type="secondary" className={styles.cnImageLabel}>原图</Text>
                                  <Image
                                    src={cnImageUrl}
                                    alt="控制图"
                                    width={100}
                                    height={100}
                                    style={{ objectFit: 'cover', borderRadius: 6 }}
                                  />
                                </div>
                                <div className={styles.cnImageBox}>
                                  <Text type="secondary" className={styles.cnImageLabel}>预处理</Text>
                                  {controlNetPreviewLoading ? (
                                    <div className={styles.cnPreviewPlaceholder}>
                                      <Spin size="small" />
                                    </div>
                                  ) : controlNetPreviewUrl ? (
                                    <Image
                                      src={controlNetPreviewUrl}
                                      alt="预处理预览"
                                      width={100}
                                      height={100}
                                      style={{ objectFit: 'cover', borderRadius: 6 }}
                                    />
                                  ) : (
                                    <div className={styles.cnPreviewPlaceholder}>
                                      <Text type="secondary" style={{ fontSize: 11 }}>等待预览</Text>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                size="small"
                                onClick={handleCnRemoveImage}
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
                                handleCnUpload(file);
                                return false;
                              }}
                              className={styles.uploader}
                              disabled={cnUploading}
                              style={{ padding: '8px 0' }}
                            >
                              <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
                                <InboxOutlined style={{ fontSize: 24 }} />
                              </p>
                              <p className="ant-upload-text" style={{ fontSize: 12 }}>
                                {cnUploading ? '上传中...' : '上传控制图'}
                              </p>
                            </Dragger>
                          )}
                        </div>

                        {/* 强度滑块 */}
                        <div className={styles.cnField}>
                          <Text type="secondary" className={styles.cnLabel}>
                            控制强度: {cnStrength.toFixed(1)}
                          </Text>
                          <Slider
                            min={0}
                            max={2}
                            step={0.1}
                            value={cnStrength}
                            onChange={setCnStrength}
                          />
                        </div>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
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

          {/* 总进度 */}
          <Progress
            percent={Math.round((currentFrame / Math.max(totalFrames, 1)) * 100)}
            status="active"
            strokeColor={{
              '0%': '#3b82f6',
              '100%': '#22c55e',
            }}
          />

          {/* 帧进度详情 */}
          {totalFrames > 1 && (
            <div className={styles.frameProgress}>
              <Text type="secondary" className={styles.frameText}>
                生成中 {currentFrame}/{totalFrames}
              </Text>
              <Progress
                percent={Math.round(frameProgress * 100)}
                size="small"
                showInfo={false}
                strokeColor="#8b5cf6"
              />
            </div>
          )}

          <Text type="secondary" className={styles.progressHint}>
            任务 #{currentTask.id} · {currentTask.type === 'txt2img' ? '文生图' : '图生图'}
          </Text>
        </Card>
      )}

      {/* 最近完成 */}
      {currentTask && (currentTask.status === 'completed' || currentTask.status === 'partial') && (
        <Card className={styles.progressCard} bordered={false}>
          <div className={styles.progressHeader}>
            <Text strong>最近完成</Text>
            <Tag color={currentTask.status === 'completed' ? 'success' : 'warning'}>
              {currentTask.status === 'completed' ? '已完成' : '部分完成'}
            </Tag>
          </div>
          <Text type="secondary">
            任务 #{currentTask.id} · 生成了 {currentTask.output_paths.length} 张图片
          </Text>
        </Card>
      )}
    </div>
  );
}
