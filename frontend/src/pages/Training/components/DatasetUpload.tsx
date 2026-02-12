import { Upload, Typography, Alert } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { useTrainingStore } from '@/stores';

const { Dragger } = Upload;
const { Text } = Typography;

/**
 * 步骤 2: 素材集上传
 */
export function DatasetUpload() {
  const { formData, updateFormData } = useTrainingStore();

  return (
    <div>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        上传训练素材图片，系统会自动处理和标注。
      </Text>

      <Alert
        type="info"
        showIcon
        message="素材要求"
        description={
          <ul style={{ margin: '8px 0', paddingLeft: 16 }}>
            <li>支持 JPG、PNG 格式</li>
            <li>建议 10-50 张图片</li>
            <li>建议分辨率不低于 512×512</li>
            <li>图片风格尽量统一</li>
          </ul>
        }
        style={{ marginBottom: 20 }}
      />

      <Dragger
        accept="image/jpeg,image/png"
        multiple
        beforeUpload={() => false}
        onChange={({ fileList }) => {
          const files: File[] = [];
          for (const f of fileList) {
            if (f.originFileObj) {
              files.push(f.originFileObj as unknown as File);
            }
          }
          updateFormData({ datasetFiles: files });
        }}
        style={{ padding: '20px 0' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽上传训练素材</p>
        <p className="ant-upload-hint">
          已选择 {formData.datasetFiles.length} 个文件
        </p>
      </Dragger>
    </div>
  );
}
