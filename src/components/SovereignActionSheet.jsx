import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { colors, typography, spacing, radius } from '../theme/veritas';

export default function SovereignActionSheet({ visible, onClose, title, options }) {
  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.sheet}>
              {title && <Text style={styles.title}>{title}</Text>}
              {options.map((opt, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.optionBtn, idx === options.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => {
                    onClose();
                    // setTimeout to allow modal exit animation without freezing the thread
                    setTimeout(opt.onPress, 50);
                  }}
                >
                  <Text style={[styles.optionText, opt.destructive && { color: colors.red }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(5,5,5,0.85)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.obsidianLight,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.goldDim,
  },
  title: {
    ...typography.title,
    fontSize: 14,
    color: colors.gold,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  optionBtn: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  optionText: {
    color: colors.text,
    fontSize: 16,
    letterSpacing: 2,
    fontFamily: 'Courier New',
  },
  cancelBtn: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.obsidian,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    color: colors.textDim,
    fontSize: 16,
    letterSpacing: 2,
    fontFamily: 'Courier New',
  }
});
