import { useEffect, useMemo } from 'react';
import {
  Table,
  Tag,
  Typography,
  Select,
  Space,
  Image,
  Button,
  Progress,
} from 'antd';
import {
  ReloadOutlined,
  ExperimentOutlined,
  PictureOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { TaskListItem } from '@/types';
import { useTaskStore } from '@/stores';
import { formatDateTime, getStatusInfo } from '@/utils/format';
import styles from './History.module.css';

const { Title, Text } = Typography;

const kindLabels: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  training: { label: '训练', color: 'purple', icon: <ExperimentOutlined /> },
  generation: { label: '生成', color: 'blue', icon: <PictureOutlined /> },
  remove_bg: { label: '抠图', color: 'green', icon: <ScissorOutlined /> },
};

export default function HistoryPage() {
  const { tasks, loading, filter, fetchTasks, setFilter } = useTaskStore();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // 过滤逻辑
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filter.kind !== 'all' && t.task_kind !== filter.kind) return false;
      if (filter.status !== 'all' && t.status !== filter.status) return false;
      return true;
    });
  }, [tasks, filter]);

  const columns: ColumnsType<TaskListItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 70,
      render: (id: number) => <Text type="secondary">#{id}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'task_kind',
      key: 'task_kind',
      width: 100,
      render: (kind: string) => {
        const info = kindLabels[kind] ?? { label: kind, color: 'default', icon: null };
        return (
          <Tag color={info.color} icon={info.icon}>
            {info.label}
          </Tag>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const info = getStatusInfo(status);
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: '进度',
      key: 'progress',
      width: 150,
      render: (_: unknown, record: TaskListItem) => {
        if (record.task_kind === 'training' && record.progress != null) {
          return (
            <Progress
              percent={Math.round(record.progress)}
              size="small"
              status={record.status === 'failed' ? 'exception' : undefined}
            />
          );
        }
        if (record.task_kind === 'generation' && record.status === 'completed') {
          return (
            <Text type="secondary">
              {record.output_paths?.length ?? 0} 张图片
            </Text>
          );
        }
        return <Text type="secondary">—</Text>;
      },
    },
    {
      title: '输出',
      key: 'output',
      width: 200,
      render: (_: unknown, record: TaskListItem) => {
        if (record.output_paths && record.output_paths.length > 0) {
          return (
            <Image.PreviewGroup>
              <Space size={4}>
                {record.output_paths.slice(0, 3).map((path, i) => (
                  <Image
                    key={i}
                    src={path}
                    alt={`output-${i}`}
                    width={40}
                    height={40}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                  />
                ))}
                {record.output_paths.length > 3 && (
                  <Text type="secondary" className={styles.moreImages}>
                    +{record.output_paths.length - 3}
                  </Text>
                )}
              </Space>
            </Image.PreviewGroup>
          );
        }
        return <Text type="secondary">—</Text>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 140,
      render: (time: string) => (
        <Text type="secondary">{formatDateTime(time)}</Text>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      {/* 页头 */}
      <div className={styles.header}>
        <Title level={4} className={styles.title}>
          历史任务
        </Title>
        <Space>
          <Select
            value={filter.kind}
            onChange={(v) => setFilter({ kind: v })}
            style={{ width: 120 }}
            options={[
              { value: 'all', label: '全部类型' },
              { value: 'generation', label: '生成任务' },
              { value: 'remove_bg', label: '抠图任务' },
              { value: 'training', label: '训练任务' },
            ]}
          />
          <Select
            value={filter.status}
            onChange={(v) => setFilter({ status: v })}
            style={{ width: 120 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'queued', label: '排队中' },
              { value: 'running', label: '进行中' },
              { value: 'completed', label: '已完成' },
              { value: 'failed', label: '失败' },
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={fetchTasks}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {/* 任务表格 */}
      <Table
        columns={columns}
        dataSource={filteredTasks}
        rowKey={(r) => `${r.task_kind}-${r.id}`}
        loading={loading}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条记录`,
        }}
        size="middle"
        className={styles.table}
      />
    </div>
  );
}
