import { useEffect } from 'react';
import { useStyleStore } from '@/stores';
import { StyleList } from './components/StyleList';
import { GenerationPanel } from './components/GenerationPanel';
import { ResultGallery } from './components/ResultGallery';
import styles from './Home.module.css';

/**
 * 首页 - 三栏布局
 * 左：风格列表 | 中：生成操作 | 右：生成结果
 */
export default function Home() {
  const fetchStyles = useStyleStore((s) => s.fetchStyles);

  useEffect(() => {
    fetchStyles();
  }, [fetchStyles]);

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <StyleList />
      </aside>
      <main className={styles.main}>
        <GenerationPanel />
      </main>
      <aside className={styles.results}>
        <ResultGallery />
      </aside>
    </div>
  );
}
