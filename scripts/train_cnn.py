import os
import cv2
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, optimizers
from tensorflow.keras.applications import VGG16, ResNet50, DenseNet121, EfficientNetV2S
from tensorflow.keras.applications.vgg16 import preprocess_input as prep_vgg16
from tensorflow.keras.applications.resnet50 import preprocess_input as prep_resnet50
from tensorflow.keras.applications.densenet import preprocess_input as prep_densenet
from tensorflow.keras.applications.efficientnet_v2 import preprocess_input as prep_effnetv2
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.callbacks import EarlyStopping

IMG_SIZE = 128

def load_images(base_path, architecture='vgg16'):
    X, y = [], []
    for label, folder in enumerate(['healthy', 'parkinson']):
        path = os.path.join(base_path, folder)
        if not os.path.exists(path):
            continue
        for img_name in os.listdir(path):
            img_path = os.path.join(path, img_name)
            img = cv2.imread(img_path) 
            if img is not None:
                img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
                img = cv2.resize(img, (IMG_SIZE, IMG_SIZE))
                X.append(img)
                y.append(label)
    
    if len(X) == 0: return np.array([]), np.array([])
    
    X = np.array(X).astype('float32')
    y = np.array(y)

    # Apply specific preprocessing
    if architecture == 'vgg16':
        X = prep_vgg16(X)
    elif architecture == 'resnet50':
        X = prep_resnet50(X)
    elif architecture == 'densenet121':
        X = prep_densenet(X)
    elif architecture == 'efficientnetv2s':
        X = prep_effnetv2(X)
    else:
        X = X / 255.0 # fallback
        
    return X, y

def build_transfer_model(architecture='vgg16'):
    input_shape = (IMG_SIZE, IMG_SIZE, 3)
    if architecture == 'vgg16':
        base_model = VGG16(weights='imagenet', include_top=False, input_shape=input_shape)
    elif architecture == 'resnet50':
        base_model = ResNet50(weights='imagenet', include_top=False, input_shape=input_shape)
    elif architecture == 'densenet121':
        base_model = DenseNet121(weights='imagenet', include_top=False, input_shape=input_shape)
    elif architecture == 'efficientnetv2s':
        base_model = EfficientNetV2S(weights='imagenet', include_top=False, input_shape=input_shape)
    else:
        raise ValueError("Unsupported architecture")

    base_model.trainable = False 
    
    model = models.Sequential([
        base_model,
        layers.GlobalAveragePooling2D(),
        layers.Dense(256, activation='relu'),
        layers.Dropout(0.5),
        layers.Dense(1, activation='sigmoid')
    ])
    
    model.compile(optimizer=optimizers.Adam(learning_rate=0.0001), 
                  loss='binary_crossentropy', 
                  metrics=['accuracy'])
    return model

datagen = ImageDataGenerator(
    rotation_range=20,
    width_shift_range=0.2,
    height_shift_range=0.2,
    shear_range=0.15,
    zoom_range=0.15,
    horizontal_flip=True,
    fill_mode='nearest'
)

early_stop = EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True)

def train_modality(name, data_path, architecture='vgg16'):
    print(f"\n--- Training {name.upper()} with {architecture.upper()} Transfer Learning ---")
    X, y = load_images(data_path, architecture)
    
    if len(X) > 0:
        model = build_transfer_model(architecture)
        
        history = model.fit(
            datagen.flow(X, y, batch_size=8),
            epochs=50,
            validation_data=(X, y),
            callbacks=[early_stop]
        )
        
        model.save(f'models/{name}_{architecture}.keras')
        print(f"✅ {name.upper()} {architecture.upper()} Model Saved!")
    else:
        print(f"❌ No data for {name}")

if __name__ == "__main__":
    os.makedirs('models', exist_ok=True)
    # Train across multiple backbones for comparison as per the paper
    architectures = ['vgg16', 'resnet50', 'densenet121', 'efficientnetv2s']
    for arch in architectures:
        train_modality('spiral', 'data/drawings/spiral/training', architecture=arch)
        train_modality('wave', 'data/drawings/wave/training', architecture=arch)