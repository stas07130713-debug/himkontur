package ru.ahov.forecast;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

@CapacitorPlugin(name = "HimkonturOcr")
public class HimkonturOcrPlugin extends Plugin {
    private final TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

    @PluginMethod
    public void recognize(PluginCall call) {
        String encoded = call.getString("image", "");
        if (encoded.isEmpty()) {
            call.reject("Изображение для распознавания не передано.");
            return;
        }
        getBridge().execute(() -> {
            final Bitmap bitmap;
            try {
                byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null) throw new IllegalArgumentException("Android не смог декодировать изображение.");
            } catch (Exception error) {
                call.reject("Не удалось подготовить изображение для автономного распознавания.", error);
                return;
            }
            recognizer.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener(result -> {
                    JSArray elements = new JSArray();
                    for (Text.TextBlock block : result.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            appendElement(elements, line.getText(), line.getBoundingBox(), line.getConfidence());
                            for (Text.Element element : line.getElements()) {
                                appendElement(elements, element.getText(), element.getBoundingBox(), element.getConfidence());
                            }
                        }
                    }
                    JSObject response = new JSObject();
                    response.put("elements", elements);
                    call.resolve(response);
                })
                .addOnFailureListener(error -> call.reject("Автономное распознавание Android завершилось с ошибкой.", error))
                .addOnCompleteListener(task -> bitmap.recycle());
        });
    }

    private void appendElement(JSArray elements, String text, Rect box, float confidence) {
        if (box == null) return;
        JSObject item = new JSObject();
        item.put("text", text);
        item.put("x", box.left);
        item.put("y", box.top);
        item.put("width", box.width());
        item.put("height", box.height());
        item.put("confidence", confidence);
        elements.put(item);
    }

    @Override
    protected void handleOnDestroy() {
        recognizer.close();
        super.handleOnDestroy();
    }
}
