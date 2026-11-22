package com.lerne.app;

import static org.junit.Assert.assertThrows;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class MaterialZipHeadersTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    private File createArchive() throws IOException {
        File file = temp.newFile();
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(file.toPath()))) {
            zip.putNextEntry(new ZipEntry("manifest.json"));
            zip.write(new byte[] {1, 2, 3});
            zip.closeEntry();
        }
        return file;
    }

    @Test
    public void acceptsJavaZipOutputStreamWithDataDescriptor() throws IOException {
        MaterialZipHeaders.verify(createArchive(), 1);
    }

    @Test
    public void rejectsDifferentLocalFilename() throws IOException {
        File file = createArchive();
        byte[] archive = Files.readAllBytes(file.toPath());
        archive[30] ^= 1;
        Files.write(file.toPath(), archive);
        assertThrows(IOException.class, () -> MaterialZipHeaders.verify(file, 1));
    }

    @Test
    public void rejectsSymlinkMetadataAndInvalidDescriptor() throws IOException {
        File file = createArchive();
        ByteBuffer archive = ByteBuffer.wrap(Files.readAllBytes(file.toPath())).order(ByteOrder.LITTLE_ENDIAN);
        int central = archive.getInt(archive.capacity() - 6);
        int attributes = archive.getInt(central + 38);
        archive.putInt(central + 38, 0120000 << 16);
        Files.write(file.toPath(), archive.array());
        assertThrows(IOException.class, () -> MaterialZipHeaders.verify(file, 1));

        archive.putInt(central + 38, attributes);
        archive.putInt(central - 12, archive.getInt(central - 12) ^ 1);
        Files.write(file.toPath(), archive.array());
        assertThrows(IOException.class, () -> MaterialZipHeaders.verify(file, 1));
    }
}
