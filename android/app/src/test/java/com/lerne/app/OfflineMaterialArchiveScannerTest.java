package com.lerne.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import com.lerne.app.OfflineMaterialArchivePlugin.MediaScanResult;
import com.lerne.app.OfflineMaterialArchivePlugin.MediaStatResult;
import com.lerne.app.OfflineMaterialArchivePlugin.ScannedMediaAsset;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Locale;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class OfflineMaterialArchiveScannerTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    private static byte[] makePngBytes() {
        return new byte[] {
            (byte) 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x02, 0x00, 0x00, 0x00, (byte) 0x90, 0x77, 0x53,
            (byte) 0xde, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
            0x44, (byte) 0xae, 0x42, 0x60, (byte) 0x82
        };
    }

    private static byte[] makeWavBytes() {
        int sampleBytes = 128;
        int totalSize = 44 + sampleBytes;
        ByteBuffer buf = ByteBuffer.allocate(totalSize).order(ByteOrder.LITTLE_ENDIAN);
        buf.put(new byte[] {'R', 'I', 'F', 'F'});
        buf.putInt(36 + sampleBytes);
        buf.put(new byte[] {'W', 'A', 'V', 'E'});
        buf.put(new byte[] {'f', 'm', 't', ' '});
        buf.putInt(16);
        buf.putShort((short) 1);
        buf.putShort((short) 1);
        buf.putInt(8000);
        buf.putInt(16000);
        buf.putShort((short) 2);
        buf.putShort((short) 16);
        buf.put(new byte[] {'d', 'a', 't', 'a'});
        buf.putInt(sampleBytes);
        return buf.array();
    }

    private static byte[] makeMp4Bytes() {
        byte[] bytes = new byte[64];
        bytes[0] = 0x00;
        bytes[1] = 0x00;
        bytes[2] = 0x00;
        bytes[3] = 0x20;
        bytes[4] = 'f';
        bytes[5] = 't';
        bytes[6] = 'y';
        bytes[7] = 'p';
        bytes[8] = 'i';
        bytes[9] = 's';
        bytes[10] = 'o';
        bytes[11] = 'm';
        return bytes;
    }

    private static String sha256Hex(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            sb.append(String.format(Locale.US, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    private static File writeAsset(File root, String folder, String filename, byte[] bytes) throws IOException {
        File dir = new File(root, folder);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create folder " + folder);
        }
        File file = new File(dir, filename);
        Files.write(file.toPath(), bytes);
        return file;
    }

    @Test
    public void scansValidPngWavMp4AndIgnoresPartials() throws Exception {
        File mediaRoot = temp.newFolder("lerne-offline-media");
        byte[] png = makePngBytes();
        byte[] wav = makeWavBytes();
        byte[] mp4 = makeMp4Bytes();

        String pngSha = sha256Hex(png);
        String wavSha = sha256Hex(wav);
        String mp4Sha = sha256Hex(mp4);

        String pngName = "archive_" + pngSha + ".png";
        String wavName = "archive_" + wavSha + ".wav";
        String mp4Name = "archive_" + mp4Sha + ".mp4";

        writeAsset(mediaRoot, "images", pngName, png);
        writeAsset(mediaRoot, "audio", wavName, wav);
        writeAsset(mediaRoot, "videos", mp4Name, mp4);

        File partial = writeAsset(mediaRoot, "images", pngName + ".12345678.partial", png);
        File stray = writeAsset(mediaRoot, "images", "stray-note.txt", new byte[] {1, 2, 3});

        MediaScanResult scan = OfflineMaterialArchivePlugin.scanMediaRoot(mediaRoot, null);
        assertEquals(3, scan.assets.size());
        assertEquals(0, scan.invalid.size());

        ScannedMediaAsset imgAsset = scan.assets.get(0);
        assertEquals("images", imgAsset.folder);
        assertEquals(pngName, imgAsset.filename);
        assertEquals("images/" + pngName, imgAsset.relativePath);
        assertEquals(pngSha, imgAsset.sha256);
        assertEquals(png.length, imgAsset.size);
        assertEquals("image/png", imgAsset.mime);
        assertEquals("media/" + pngSha + ".png", imgAsset.path);

        MediaScanResult videoOnly = OfflineMaterialArchivePlugin.scanMediaRoot(mediaRoot, "videos");
        assertEquals(1, videoOnly.assets.size());
        assertEquals("video/mp4", videoOnly.assets.get(0).mime);
        assertEquals("videos/" + mp4Name, videoOnly.assets.get(0).relativePath);

        assertTrue("Partial file must not be deleted by scan", partial.isFile());
        assertTrue("Non-canonical file must not be deleted by scan", stray.isFile());
    }

    @Test
    public void reportsShaMismatchAndSignatureMismatchWithoutDeletingFiles() throws Exception {
        File mediaRoot = temp.newFolder("lerne-offline-media-corrupt");
        byte[] png = makePngBytes();
        String expectedSha = sha256Hex(png);
        byte[] tampered = png.clone();
        tampered[tampered.length - 1] ^= 0x01;

        String pngName = "archive_" + expectedSha + ".png";
        File corruptFile = writeAsset(mediaRoot, "images", pngName, tampered);

        byte[] wrongMagic = makePngBytes();
        String wrongSha = sha256Hex(wrongMagic);
        String wrongExtName = "archive_" + wrongSha + ".mp4";
        File wrongExtFile = writeAsset(mediaRoot, "videos", wrongExtName, wrongMagic);

        MediaScanResult scan = OfflineMaterialArchivePlugin.scanMediaRoot(mediaRoot, null);
        assertEquals(0, scan.assets.size());
        assertEquals(2, scan.invalid.size());
        assertTrue("Corrupted SHA file must NOT be auto-deleted", corruptFile.isFile());
        assertTrue("Mismatched signature file must NOT be auto-deleted", wrongExtFile.isFile());

        MediaStatResult corruptStat = OfflineMaterialArchivePlugin.statSingleMediaAsset(mediaRoot, "images", pngName);
        assertTrue(corruptStat.exists);
        assertFalse(corruptStat.valid);
        assertEquals("SHA-256 mismatch", corruptStat.reason);

        MediaStatResult missingStat = OfflineMaterialArchivePlugin.statSingleMediaAsset(
            mediaRoot,
            "audio",
            "archive_" + "0".repeat(64) + ".wav"
        );
        assertFalse(missingStat.exists);
        assertFalse(missingStat.valid);
    }

    @Test
    public void rejectsPathTraversalAndUnsafeInputs() throws Exception {
        File mediaRoot = temp.newFolder("lerne-offline-media-traversal");
        String fakeName = "archive_" + "a".repeat(64) + ".png";

        assertThrows(
            IOException.class,
            () -> OfflineMaterialArchivePlugin.statSingleMediaAsset(mediaRoot, "../images", fakeName)
        );
        assertThrows(
            IOException.class,
            () -> OfflineMaterialArchivePlugin.statSingleMediaAsset(mediaRoot, "images", "../../etc/passwd")
        );
        assertThrows(
            IOException.class,
            () -> OfflineMaterialArchivePlugin.statSingleMediaAsset(mediaRoot, "unknown", fakeName)
        );
        assertThrows(
            IOException.class,
            () -> OfflineMaterialArchivePlugin.scanMediaRoot(mediaRoot, "../images")
        );
    }
}
