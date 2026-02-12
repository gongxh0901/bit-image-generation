import {
  Typography,
  Button,
  Checkbox,
  Image,
  Space,
  Empty,
  Tooltip,
  message,
} from 'antd';
import {
  DownloadOutlined,
  SelectOutlined,
  FileZipOutlined,
  CloudDownloadOutlined,
} from '@ant-design/icons';
import { useStyleStore, useGenerationStore } from '@/stores';
import { downloadImage, downloadImagesAsZip } from '@/utils/download';
import styles from './ResultGallery.module.css';

const { Text, Title } = Typography;

/**
 * 右侧栏 - 生成结果画廊
 */
export function ResultGallery() {
  const selectedStyleId = useStyleStore((s) => s.selectedStyleId);
  const history = useGenerationStore((s) => s.history);
  const selectedImages = useGenerationStore((s) => s.selectedImages);
  const toggleImage = useGenerationStore((s) => s.toggleImageSelection);
  const selectAll = useGenerationStore((s) => s.selectAllImages);
  const clearSelection = useGenerationStore((s) => s.clearSelection);

  const results = selectedStyleId ? history[selectedStyleId] ?? [] : [];
  const allUrls = results.map((r) => r.imageUrl);
  const isAllSelected = results.length > 0 && selectedImages.size === results.length;
  const hasSelection = selectedImages.size > 0;

  const handleSelectAll = () => {
    if (isAllSelected) {
      clearSelection();
    } else {
      selectAll(allUrls);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedImages.size === 0) return;
    try {
      if (selectedImages.size === 1) {
        const url = [...selectedImages][0];
        await downloadImage(url);
      } else {
        await downloadImagesAsZip([...selectedImages]);
      }
      message.success('下载完成');
    } catch {
      message.error('下载失败');
    }
  };

  const handleDownloadAll = async () => {
    if (results.length === 0) return;
    try {
      await downloadImagesAsZip(allUrls);
      message.success('下载完成');
    } catch {
      message.error('下载失败');
    }
  };

  return (
    <div className={styles.container}>
      {/* 标题栏 */}
      <div className={styles.header}>
        <Title level={5} className={styles.title}>
          生成结果 {results.length > 0 && <span className={styles.count}>({results.length})</span>}
        </Title>
      </div>

      {/* 操作栏 */}
      {results.length > 0 && (
        <div className={styles.toolbar}>
          <Button
            type="text"
            size="small"
            icon={<SelectOutlined />}
            onClick={handleSelectAll}
            className={styles.toolBtn}
          >
            {isAllSelected ? '取消全选' : '全选'}
          </Button>
          <Space size={4}>
            <Tooltip title="下载选中">
              <Button
                type="text"
                size="small"
                icon={<FileZipOutlined />}
                disabled={!hasSelection}
                onClick={handleDownloadSelected}
                className={styles.toolBtn}
              >
                {hasSelection ? `下载 (${selectedImages.size})` : '下载选中'}
              </Button>
            </Tooltip>
            <Tooltip title="下载全部">
              <Button
                type="text"
                size="small"
                icon={<CloudDownloadOutlined />}
                onClick={handleDownloadAll}
                className={styles.toolBtn}
              />
            </Tooltip>
          </Space>
        </div>
      )}

      {/* 图片网格 */}
      <div className={styles.gallery}>
        {results.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无生成结果"
            className={styles.empty}
          />
        ) : (
          <Image.PreviewGroup>
            <div className={styles.grid}>
              {results.map((result) => {
                const isChecked = selectedImages.has(result.imageUrl);
                return (
                  <div
                    key={result.id}
                    className={`${styles.imageCard} ${isChecked ? styles.imageChecked : ''}`}
                  >
                    {/* 选择框 */}
                    <div className={styles.checkWrap}>
                      <Checkbox
                        checked={isChecked}
                        onChange={() => toggleImage(result.imageUrl)}
                      />
                    </div>

                    {/* 图片 */}
                    <Image
                      src={result.imageUrl}
                      alt={result.filename}
                      className={styles.image}
                      placeholder
                      fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzFhMjMzMiIvPjx0ZXh0IHg9IjEwMCIgeT0iMTAwIiBmaWxsPSIjNjQ3NDhiIiBmb250LXNpemU9IjE0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIj7liqDovb3lpLHotKU8L3RleHQ+PC9zdmc+"
                    />

                    {/* 单图下载按钮 */}
                    <div className={styles.downloadOverlay}>
                      <Button
                        type="text"
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadImage(result.imageUrl, result.filename);
                        }}
                        className={styles.downloadBtn}
                      />
                    </div>

                    {/* 文件名 */}
                    <div className={styles.imageName}>
                      <Text type="secondary" ellipsis className={styles.filename}>
                        {result.filename}
                      </Text>
                    </div>
                  </div>
                );
              })}
            </div>
          </Image.PreviewGroup>
        )}
      </div>
    </div>
  );
}
