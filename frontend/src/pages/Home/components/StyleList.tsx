import { List, Tag, Spin, Empty, Typography, Button, Space } from 'antd';
import {
  PlusOutlined,
  LoadingOutlined,
  AppstoreOutlined,
  FireOutlined,
} from '@ant-design/icons';
import { useStyleStore } from '@/stores';
import { useState } from 'react';
import { CreateStyleModal } from './CreateStyleModal';
import styles from './StyleList.module.css';

const { Text, Title } = Typography;

const typeIcon: Record<string, React.ReactNode> = {
  ui: <AppstoreOutlined />,
  vfx: <FireOutlined />,
};

const typeColor: Record<string, string> = {
  ui: 'blue',
  vfx: 'volcano',
};

/**
 * 左侧风格列表
 */
export function StyleList() {
  const {
    styles: styleList,
    selectedStyleId,
    generatingStyleIds,
    loading,
    selectStyle,
  } = useStyleStore();

  const [createModalOpen, setCreateModalOpen] = useState(false);

  return (
    <div className={styles.container}>
      {/* 标题栏 */}
      <div className={styles.header}>
        <Title level={5} className={styles.title}>
          风格列表
        </Title>
        <Button
          type="text"
          icon={<PlusOutlined />}
          size="small"
          onClick={() => setCreateModalOpen(true)}
          className={styles.addBtn}
        />
      </div>

      {/* 列表 */}
      <div className={styles.listWrap}>
        {loading ? (
          <div className={styles.center}>
            <Spin indicator={<LoadingOutlined />} />
          </div>
        ) : styleList.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无风格"
            className={styles.empty}
          >
            <Button type="primary" size="small" onClick={() => setCreateModalOpen(true)}>
              创建风格
            </Button>
          </Empty>
        ) : (
          <List
            dataSource={styleList}
            renderItem={(style) => {
              const isSelected = style.id === selectedStyleId;
              const isGenerating = generatingStyleIds.has(style.id);

              return (
                <div
                  className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                  onClick={() => selectStyle(style.id)}
                >
                  <div className={styles.itemContent}>
                    <Space size={8} align="center">
                      <span className={styles.itemIcon}>
                        {typeIcon[style.type] ?? <AppstoreOutlined />}
                      </span>
                      <div>
                        <Text strong className={styles.itemName}>
                          {style.name}
                        </Text>
                        <div className={styles.itemMeta}>
                          <Tag
                            color={typeColor[style.type] ?? 'default'}
                            className={styles.tag}
                          >
                            {style.type.toUpperCase()}
                          </Tag>
                          {isGenerating && (
                            <Tag color="processing" icon={<LoadingOutlined />} className={styles.tag}>
                              生成中
                            </Tag>
                          )}
                        </div>
                      </div>
                    </Space>
                  </div>
                  {isSelected && <div className={styles.indicator} />}
                </div>
              );
            }}
          />
        )}
      </div>

      {/* 风格数量 */}
      {styleList.length > 0 && (
        <div className={styles.footer}>
          <Text type="secondary" className={styles.count}>
            共 {styleList.length} 个风格
          </Text>
        </div>
      )}

      <CreateStyleModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
    </div>
  );
}
