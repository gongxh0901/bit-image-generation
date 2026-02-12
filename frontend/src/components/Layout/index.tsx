import { Layout as AntLayout } from 'antd';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import styles from './Layout.module.css';

const { Content } = AntLayout;

/**
 * 全局布局组件
 * 顶部导航 + 内容区
 */
export function Layout() {
  return (
    <AntLayout className={styles.layout}>
      <Header />
      <Content className={styles.content}>
        <Outlet />
      </Content>
    </AntLayout>
  );
}
