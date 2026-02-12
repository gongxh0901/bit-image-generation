import { List, Tag, Spin, Empty, Typography, Button, Space, Popconfirm, message } from 'antd';
import {
  PlusOutlined,
  LoadingOutlined,
  AppstoreOutlined,
  FireOutlined,
  StarFilled,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useStyleStore } from '@/stores';
import { useState } from 'react';
import type { Style } from '@/types';
import { CreateStyleModal } from './CreateStyleModal';
import { EditStyleModal } from './EditStyleModal';
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
    deleteStyle,
  } = useStyleStore();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingStyle, setEditingStyle] = useState<Style | null>(null);

  const handleEdit = (e: React.MouseEvent, style: Style) => {
    e.stopPropagation();
    setEditingStyle(style);
    setEditModalOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent | undefined, style: Style) => {
    e?.stopPropagation();
    try {
      await deleteStyle(style.id);
      message.success(`已删除风格「${style.name}」`);
    } catch {
      message.error('删除失败');
    }
  };

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
                  className={`${styles.item} ${isSelected ? styles.selected : ''} ${style.is_base ? styles.baseItem : ''}`}
                  onClick={() => selectStyle(style.id)}
                >
                  <div className={styles.itemContent}>
                    <Space size={8} align="center" style={{ flex: 1 }}>
                      <span className={`${styles.itemIcon} ${style.is_base ? styles.baseIcon : ''}`}>
                        {style.is_base ? <StarFilled /> : (typeIcon[style.type] ?? <AppstoreOutlined />)}
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
                          {style.is_base && (
                            <Tag color="gold" className={styles.tag}>
                              内置
                            </Tag>
                          )}
                          {!style.is_base && style.is_trained && (
                            <Tag color="green" className={styles.tag}>
                              已训练
                            </Tag>
                          )}
                          {!style.is_base && !style.is_trained && (
                            <Tag color="default" className={styles.tag}>
                              未训练
                            </Tag>
                          )}
                          {isGenerating && (
                            <Tag color="processing" icon={<LoadingOutlined />} className={styles.tag}>
                              生成中
                            </Tag>
                          )}
                        </div>
                      </div>
                    </Space>
                    {/* 操作按钮 */}
                    <div className={styles.actions}>
                      {!style.is_base && (
                        <>
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(e) => handleEdit(e, style)}
                            className={styles.actionBtn}
                          />
                          <Popconfirm
                            title="确认删除"
                            description={`确定要删除风格「${style.name}」吗？`}
                            onConfirm={(e) => handleDelete(e, style)}
                            onCancel={(e) => e?.stopPropagation()}
                            okText="删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={(e) => e.stopPropagation()}
                              className={styles.actionBtn}
                            />
                          </Popconfirm>
                        </>
                      )}
                    </div>
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

      <EditStyleModal
        open={editModalOpen}
        style={editingStyle}
        onClose={() => {
          setEditModalOpen(false);
          setEditingStyle(null);
        }}
      />
    </div>
  );
}
