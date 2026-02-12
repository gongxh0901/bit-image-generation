import { theme, type ThemeConfig } from 'antd';

/** 暗色主题配置 - 游戏工具风格 */
export const darkThemeConfig: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    // 品牌色
    colorPrimary: '#3b82f6',
    colorSuccess: '#22c55e',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',

    // 背景色
    colorBgContainer: '#1e293b',
    colorBgLayout: '#0f172a',
    colorBgElevated: '#334155',

    // 文字色
    colorText: '#e2e8f0',
    colorTextSecondary: '#94a3b8',
    colorTextTertiary: '#64748b',

    // 边框
    colorBorder: '#334155',
    colorBorderSecondary: '#475569',

    // 圆角
    borderRadius: 8,
    borderRadiusLG: 12,

    // 字体
    fontFamily:
      '"Noto Sans SC", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  components: {
    Card: {
      colorBgContainer: '#1e293b',
      headerBg: 'transparent',
    },
    Button: {
      borderRadius: 8,
      primaryShadow: '0 2px 0 rgba(0, 0, 0, 0.045)',
    },
    Input: {
      colorBgContainer: '#0f172a',
      activeBg: '#0f172a',
      hoverBg: '#0f172a',
    },
    InputNumber: {
      colorBgContainer: '#0f172a',
      activeBg: '#0f172a',
      hoverBg: '#0f172a',
    },
    Select: {
      colorBgContainer: '#0f172a',
    },
    List: {
      colorSplit: '#334155',
    },
    Progress: {
      defaultColor: '#3b82f6',
      remainingColor: '#334155',
    },
    Upload: {
      colorBgContainer: '#0f172a',
    },
    Steps: {
      colorPrimary: '#3b82f6',
    },
  },
};
