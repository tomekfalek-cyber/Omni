import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/audio_service.dart';

class VoiceRecorder extends ConsumerStatefulWidget {
  final void Function(String path) onRecordingComplete;

  const VoiceRecorder({
    super.key,
    required this.onRecordingComplete,
  });

  @override
  ConsumerState<VoiceRecorder> createState() => _VoiceRecorderState();
}

class _VoiceRecorderState extends ConsumerState<VoiceRecorder> {
  Timer? _timer;
  int _recordingSeconds = 0;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _startRecording() async {
    final audioService = ref.read(audioServiceProvider.notifier);
    await audioService.startRecording();
    
    setState(() => _recordingSeconds = 0);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() => _recordingSeconds++);
    });
  }

  void _stopRecording() async {
    _timer?.cancel();
    final audioService = ref.read(audioServiceProvider.notifier);
    final path = await audioService.stopRecording();
    
    if (path != null) {
      widget.onRecordingComplete(path);
    }
    
    setState(() => _recordingSeconds = 0);
  }

  String _formatDuration(int seconds) {
    final mins = seconds ~/ 60;
    final secs = seconds % 60;
    return '${mins.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final audioState = ref.watch(audioServiceProvider);
    final isRecording = audioState is AudioRecording;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (isRecording)
          Text(
            _formatDuration(_recordingSeconds),
            style: const TextStyle(
              fontSize: 12,
              color: Colors.red,
              fontWeight: FontWeight.bold,
            ),
          ),
        IconButton.filled(
          icon: Icon(isRecording ? Icons.stop : Icons.mic),
          backgroundColor: isRecording ? Colors.red : null,
          onPressed: isRecording ? _stopRecording : _startRecording,
        ),
      ],
    );
  }
}
