import { useState } from 'react';
import {
  Card,
  Upload,
  Button,
  Typography,
  Space,
  Image,
  Progress,
  Empty,
  message,
  Divider,
} from 'antd';
import {
  InboxOutlined,
  ScissorOutlined,
  DownloadOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { useRemoveBgStore } from '@/stores';
import { uploadImage } from '@/services/upload';
import { downloadImage } from '@/utils/download';
import styles from './RemoveBg.module.css';

const { Title, Text } = Typography;
const { Dragger } = Upload;

export default function RemoveBgPage() {
  const currentTask = useRemoveBgStore((s) => s.currentTask);
  const results = useRemoveBgStore((s) => s.results);
  const loading = useRemoveBgStore((s) => s.loading);
  const submitRemoveBg = useRemoveBgStore((s) => s.submitRemoveBg);

  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  /** 处理图片上传 */
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadImage(file);
      setUploadedUrl(result.url);
      message.success('图片上传成功');
    } catch {
      message.error('图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  /** 提交抠图 */
  const handleRemoveBg = async () => {
    if (!uploadedUrl) {
      message.warning('请先上传图片');
      return;
    }
    try {
      await submitRemoveBg(uploadedUrl);
      message.success('抠图任务已提交');
    } catch {
      message.error('抠图任务提交失败');
    }
  };

  /** 下载结果 */
  const handleDownload = () => {
    if (currentTask?.output_image) {
      downloadImage(currentTask.output_image, `rmbg_${currentTask.id}.png`);
    }
  };

  const isRunning = currentTask?.status === 'queued' || currentTask?.status === 'running';
  const isCompleted = currentTask?.status === 'completed';

  return (
    <div className={styles.container}>
      {/* 页头 */}
      <div className={styles.header}>
        <Title level={4} className={styles.title}>
          <ScissorOutlined style={{ marginRight: 8 }} />
          抠图工具
        </Title>
        <Text type="secondary">使用 BiRefNet 智能移除背景，生成透明 PNG</Text>
      </div>

      {/* 上传区域 */}
      {!uploadedUrl && (
        <Card className={styles.uploadCard} bordered={false}>
          <Dragger
            accept="image/jpeg,image/png,image/webp"
            maxCount={1}
            showUploadList={false}
            beforeUpload={(file) => {
              handleUpload(file);
              return false;
            }}
            className={styles.uploader}
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              {uploading ? '上传中...' : '点击或拖拽上传图片'}
            </p>
            <p className="ant-upload-hint">支持 JPG / PNG / WebP，最大 10MB</p>
          </Dragger>
        </Card>
      )}

      {/* 对比预览 */}
      {uploadedUrl && (
        <>
          <div className={styles.compareSection}>
            {/* 原图 */}
            <Card className={styles.compareCard} bordered={false}>
              <Text strong className={styles.compareLabel}>原图</Text>
              <div className={styles.imageWrap}>
                <Image
                  src={uploadedUrl}
                  alt="原图"
                  className={styles.resultImage}
                  placeholder
                />
              </div>
            </Card>

            {/* 抠图结果 */}
            <Card className={styles.compareCard} bordered={false}>
              <Text strong className={styles.compareLabel}>抠图结果</Text>
              <div className={`${styles.imageWrap} ${isCompleted ? styles.checkerboard : ''}`}>
                {isRunning && (
                  <div className={styles.emptyResult}>
                    <LoadingOutlined style={{ fontSize: 32, marginBottom: 12 }} />
                    <Text type="secondary">抠图处理中...</Text>
                    <div className={styles.progressWrap}>
                      <Progress percent={50} status="active" />
                    </div>
                  </div>
                )}
                {isCompleted && currentTask?.output_image && (
                  <Image
                    src={currentTask.output_image}
                    alt="抠图结果"
                    className={styles.resultImage}
                    placeholder
                  />
                )}
                {!isRunning && !isCompleted && (
                  <div className={styles.emptyResult}>
                    <ScissorOutlined style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }} />
                    <Text type="secondary">点击下方按钮开始抠图</Text>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* 操作按钮 */}
          <div className={styles.actions}>
            <Button
              type="primary"
              icon={<ScissorOutlined />}
              size="large"
              loading={loading || isRunning}
              onClick={handleRemoveBg}
            >
              {isRunning ? '处理中...' : '开始抠图'}
            </Button>
            {isCompleted && currentTask?.output_image && (
              <Button
                icon={<DownloadOutlined />}
                size="large"
                onClick={handleDownload}
              >
                下载透明 PNG
              </Button>
            )}
            <Button
              size="large"
              onClick={() => {
                setUploadedUrl(null);
              }}
            >
              重新上传
            </Button>
          </div>
        </>
      )}

      {/* 历史结果 */}
      {results.length > 0 && (
        <div className={styles.historySection}>
          <Divider />
          <Title level={5}>历史抠图结果</Title>
          <div className={styles.historyGrid}>
            {results.map((task) => (
              <Card
                key={task.id}
                className={`${styles.historyCard} ${styles.checkerboard}`}
                bordered={false}
                hoverable
                cover={
                  task.output_image ? (
                    <Image
                      src={task.output_image}
                      alt={`抠图-${task.id}`}
                      className={styles.historyImage}
                      placeholder
                    />
                  ) : null
                }
                actions={[
                  <Button
                    key="download"
                    type="text"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      if (task.output_image) {
                        downloadImage(task.output_image, `rmbg_${task.id}.png`);
                      }
                    }}
                  >
                    下载
                  </Button>,
                ]}
              >
                <Card.Meta
                  description={
                    <Space>
                      <Text type="secondary">#{task.id}</Text>
                      <Text type="secondary">{task.status}</Text>
                    </Space>
                  }
                />
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {!uploadedUrl && results.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="上传图片开始抠图"
          style={{ marginTop: 40 }}
        />
      )}
    </div>
  );
}
