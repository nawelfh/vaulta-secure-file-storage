import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { contentDisposition, createS3Storage } from '../src/storage/s3-storage.js';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://storage.example/signed'),
}));

const config = {
  region: 'us-east-1',
  endpoint: 'https://s3.example',
  forcePathStyle: true,
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  bucket: 'private-files',
  signedUrlTtlSeconds: 300,
  partSizeBytes: 10 * 1024 * 1024,
};

describe('signed download Content-Disposition', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['report.pdf', 'report.pdf', 'report.pdf'],
    ['My Report.pdf', 'My Report.pdf', 'My%20Report.pdf'],
    ['Hamza_Affes_CV (1).pdf', 'Hamza_Affes_CV (1).pdf', 'Hamza_Affes_CV%20%281%29.pdf'],
    ['file[final].pdf', 'file[final].pdf', 'file%5Bfinal%5D.pdf'],
    ["O'Reilly.pdf", "O'Reilly.pdf", 'O%27Reilly.pdf'],
    ['say "hello".pdf', 'say _hello_.pdf', 'say%20%22hello%22.pdf'],
    ['quarter;final.pdf', 'quarter;final.pdf', 'quarter%3Bfinal.pdf'],
    ['draft,final.pdf', 'draft,final.pdf', 'draft%2Cfinal.pdf'],
    ['résumé final.pdf', 'resume final.pdf', 'r%C3%A9sum%C3%A9%20final.pdf'],
  ])('creates a quoted fallback and RFC 5987 value for %s', (fileName, fallback, encoded) => {
    expect(contentDisposition(fileName))
      .toBe(`attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
  });

  it('removes CR/LF and prevents injected header syntax', () => {
    const disposition = contentDisposition('safe.pdf\r\nX-Injected: yes');

    expect(disposition).toBe("attachment; filename=\"safe.pdfX-Injected: yes\"; filename*=UTF-8''safe.pdfX-Injected%3A%20yes");
    expect(disposition).not.toMatch(/[\r\n]/);
  });

  it('passes the exact safe disposition to the SDK presigner', async () => {
    const storage = createS3Storage(config);
    const url = await storage.signDownload({
      key: 'owner-id/internal-object-id',
      fileName: 'Hamza_Affes_CV (1).pdf',
      mimeType: 'application/pdf',
    });

    expect(url).toBe('https://storage.example/signed');
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
    const [client, command, options] = getSignedUrl.mock.calls[0];
    expect(client).toBeTruthy();
    expect(command.input).toMatchObject({
      Bucket: 'private-files',
      Key: 'owner-id/internal-object-id',
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition: "attachment; filename=\"Hamza_Affes_CV (1).pdf\"; filename*=UTF-8''Hamza_Affes_CV%20%281%29.pdf",
    });
    expect(options).toEqual({ expiresIn: 300 });
  });
});
