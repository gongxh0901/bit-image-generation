import { Steps, Button, Card, Result, Space, Typography, message } from 'antd';
import {
  FormOutlined,
  CloudUploadOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTrainingStore } from '@/stores';
import { StyleForm } from './components/StyleForm';
import { DatasetUpload } from './components/DatasetUpload';
import { ParamsForm } from './components/ParamsForm';
import { TrainingConfirm } from './components/TrainingConfirm';
import styles from './Training.module.css';

const { Title } = Typography;

const stepItems = [
  { title: '基础信息', icon: <FormOutlined /> },
  { title: '上传素材', icon: <CloudUploadOutlined /> },
  { title: '配置参数', icon: <SettingOutlined /> },
  { title: '确认提交', icon: <CheckCircleOutlined /> },
];

/**
 * 训练中心页面 - 分步表单
 */
export default function Training() {
  const navigate = useNavigate();
  const { currentStep, setStep, nextStep, prevStep, submitting, resetForm } =
    useTrainingStore();

  const [submitted, setSubmitted] = React.useState(false);

  const handleSubmit = async () => {
    try {
      await useTrainingStore.getState().submitTraining();
      message.success('训练任务已提交');
      setSubmitted(true);
    } catch {
      message.error('提交失败，请重试');
    }
  };

  const handleReset = () => {
    resetForm();
    setSubmitted(false);
  };

  // 提交成功页面
  if (submitted) {
    return (
      <div className={styles.container}>
        <Result
          status="success"
          title="训练任务已提交"
          subTitle="系统正在处理您的训练请求，您可以在任务列表中查看进度"
          extra={[
            <Button type="primary" key="home" onClick={() => navigate('/')}>
              返回工作台
            </Button>,
            <Button key="new" onClick={handleReset}>
              创建新任务
            </Button>,
          ]}
          className={styles.result}
        />
      </div>
    );
  }

  const stepContent = [
    <StyleForm key="style" />,
    <DatasetUpload key="dataset" />,
    <ParamsForm key="params" />,
    <TrainingConfirm key="confirm" />,
  ];

  return (
    <div className={styles.container}>
      <div className={styles.inner}>
        {/* 面包屑标题 */}
        <div className={styles.pageHeader}>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
            className={styles.backBtn}
          >
            返回工作台
          </Button>
          <Title level={4} className={styles.pageTitle}>
            训练中心
          </Title>
        </div>

        {/* 步骤条 */}
        <Card className={styles.stepsCard} bordered={false}>
          <Steps
            current={currentStep}
            items={stepItems}
            onChange={(step) => {
              // 只允许跳到已完成的步骤
              if (step < currentStep) setStep(step);
            }}
          />
        </Card>

        {/* 表单内容 */}
        <Card className={styles.contentCard} bordered={false}>
          {stepContent[currentStep]}
        </Card>

        {/* 底部操作栏 */}
        <div className={styles.actions}>
          <Space size={12}>
            {currentStep > 0 && (
              <Button size="large" onClick={prevStep}>
                上一步
              </Button>
            )}
            {currentStep < 3 ? (
              <Button type="primary" size="large" onClick={nextStep}>
                下一步
              </Button>
            ) : (
              <Button
                type="primary"
                size="large"
                loading={submitting}
                onClick={handleSubmit}
                className={styles.submitBtn}
              >
                开始训练
              </Button>
            )}
          </Space>
        </div>
      </div>
    </div>
  );
}

// 这里需要 import React 才能使用 React.useState
import React from 'react';
