import { Layout, Menu, Badge, Typography, Space } from 'antd';
import {
  HomeOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { WSStatus } from '@/hooks/useWebSocket';
import styles from './Layout.module.css';

const { Title } = Typography;

const statusMap: Record<WSStatus, { color: string; text: string }> = {
  connected: { color: '#22c55e', text: '已连接' },
  connecting: { color: '#f59e0b', text: '连接中' },
  disconnected: { color: '#ef4444', text: '未连接' },
};

/**
 * 顶部导航栏
 */
export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useWebSocket();

  const wsInfo = statusMap[status];

  const menuItems = [
    {
      key: '/',
      icon: <HomeOutlined />,
      label: '生成工作台',
    },
    {
      key: '/remove-bg',
      icon: <ScissorOutlined />,
      label: '抠图工具',
    },
    {
      key: '/training',
      icon: <ExperimentOutlined />,
      label: '训练中心',
    },
    {
      key: '/history',
      icon: <HistoryOutlined />,
      label: '历史任务',
    },
  ];

  return (
    <Layout.Header className={styles.header}>
      <div className={styles.headerLeft}>
        <Space align="center" size={12}>
          <ThunderboltOutlined className={styles.logo} />
          <Title level={4} className={styles.title}>
            游戏素材生成系统
          </Title>
        </Space>
      </div>

      <Menu
        mode="horizontal"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        className={styles.nav}
      />

      <div className={styles.headerRight}>
        <Badge color={wsInfo.color} text={<span className={styles.wsText}>WS {wsInfo.text}</span>} />
      </div>
    </Layout.Header>
  );
}
