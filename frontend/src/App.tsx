import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { darkThemeConfig } from '@/theme';
import { Layout } from '@/components/Layout';

// 路由懒加载
const Home = lazy(() => import('@/pages/Home'));
const Training = lazy(() => import('@/pages/Training'));
const History = lazy(() => import('@/pages/History'));
const RemoveBg = lazy(() => import('@/pages/RemoveBg'));

function App() {
  return (
    <ConfigProvider theme={darkThemeConfig} locale={zhCN}>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/remove-bg" element={<RemoveBg />} />
              <Route path="/training" element={<Training />} />
              <Route path="/history" element={<History />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
