import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

/**
 * Generates a PDF report for the plant map with image and statistics
 * @param {HTMLElement} mapElement - The DOM element containing the plant map
 * @param {Object} stats - Statistics object containing:
 *   - progress: percentage (0-100)
 *   - doneCount: number of trackers marked as done
 *   - halfwayCount: number of trackers marked as halfway
 *   - notDoneCount: number of trackers not done
 *   - totalTrackers: total number of trackers
 *   - cycleNumber: current cycle number (optional)
 * @param {string} viewMode - 'grass_cutting' or 'panel_wash'
 * @param {string} filename - Optional filename (defaults to auto-generated)
 */
export async function generatePlantMapReport(mapElement, stats, viewMode, filename = null) {
  if (!mapElement) {
    throw new Error('Map element is required');
  }

  try {
    // Show loading indicator
    const loadingMsg = document.createElement('div');
    loadingMsg.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 20px 40px;
      border-radius: 8px;
      z-index: 10000;
      font-size: 16px;
      font-weight: bold;
    `;
    loadingMsg.textContent = 'Generating report...';
    document.body.appendChild(loadingMsg);

    // Capture the map as an image
    const canvas = await html2canvas(mapElement, {
      backgroundColor: '#fafafa',
      scale: 2, // Higher quality
      logging: false,
      useCORS: true,
      allowTaint: false
    });

    // Calculate dimensions
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const imgData = canvas.toDataURL('image/png');

    // PDF dimensions (A4: 210mm x 297mm)
    const pdfWidth = 210; // mm
    const pdfHeight = 297; // mm
    const margin = 15; // mm
    const contentWidth = pdfWidth - (margin * 2);
    
    // Calculate image dimensions to fit in PDF
    const imgAspectRatio = imgWidth / imgHeight;
    let finalImgWidth = contentWidth;
    let finalImgHeight = contentWidth / imgAspectRatio;
    
    // If image is too tall, scale it down
    // Leave space for header (~45mm), stats (~35mm), footer (~15mm), and margins
    const maxImgHeight = pdfHeight - 100; // Leave space for header, stats, and footer
    if (finalImgHeight > maxImgHeight) {
      finalImgHeight = maxImgHeight;
      finalImgWidth = finalImgHeight * imgAspectRatio;
    }

    // Create PDF
    const pdf = new jsPDF('portrait', 'mm', 'a4');
    
    // Add header with title
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Witkop Solar Farm Site Map Report', margin, 20);
    
    // Add view mode and date
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    const viewModeText = viewMode === 'grass_cutting' ? 'Grass Cutting' : 'Panel Washing';
    pdf.text(`Task Type: ${viewModeText}`, margin, 30);
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    pdf.text(`Report Generated: ${dateStr}`, margin, 36);
    
    // Add separator line
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, 42, pdfWidth - margin, 42);
    
    // Add statistics section
    pdf.setFontSize(13);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Progress Statistics', margin, 50);
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    let yPos = 57;
    
    // Progress percentage (highlighted)
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(`Overall Progress: ${stats.progress.toFixed(1)}%`, margin, yPos);
    yPos += 8;
    
    // Tracker counts with cycle number
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    const cycleText = stats.cycleNumber ? ` | Cycle: ${stats.cycleNumber}` : '';
    pdf.text(`Total Trackers: ${stats.totalTrackers}${cycleText}`, margin, yPos);
    yPos += 7;
    
    // Done count
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(76, 175, 80); // Green
    pdf.text(`Done: ${stats.doneCount} trackers`, margin, yPos);
    yPos += 6;
    
    // Halfway count
    pdf.setTextColor(255, 152, 0); // Orange
    pdf.text(`Halfway: ${stats.halfwayCount} trackers`, margin, yPos);
    yPos += 6;
    
    // Not Done count
    pdf.setTextColor(158, 158, 158); // Gray
    pdf.text(`Not Done: ${stats.notDoneCount} trackers`, margin, yPos);
    yPos += 10;
    
    // Reset text color
    pdf.setTextColor(0, 0, 0);
    
    // Add separator line before image
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, yPos, pdfWidth - margin, yPos);
    yPos += 5;
    
    // Add image
    const imgYPos = yPos;
    pdf.addImage(imgData, 'PNG', margin + (contentWidth - finalImgWidth) / 2, imgYPos, finalImgWidth, finalImgHeight);
    
    // Add footer
    const footerY = pdfHeight - 10;
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(128, 128, 128);
    pdf.text('This report was generated automatically by the SPHAiRDigital', margin, footerY);
    
    // Generate filename if not provided
    if (!filename) {
      const datePart = now.toISOString().split('T')[0];
      const timePart = now.toTimeString().split(' ')[0].replace(/:/g, '-');
      const viewPart = viewMode === 'grass_cutting' ? 'GrassCutting' : 'PanelWash';
      filename = `PlantMap_${viewPart}_${datePart}_${timePart}.pdf`;
    }

    // Save PDF
    pdf.save(filename);
    
    // Remove loading indicator
    document.body.removeChild(loadingMsg);
    
    return { success: true, filename };
  } catch (error) {
    console.error('Error generating plant map report:', error);
    throw error;
  }
}
